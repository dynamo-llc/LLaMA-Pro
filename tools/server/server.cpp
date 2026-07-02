#include "server-context.h"
#include "server-http.h"
#include "server-models.h"
#include "server-cors-proxy.h"
#include "server-tools.h"

#include "arg.h"
#include "build-info.h"
#include "common.h"
#include "fit.h"
#include "llama.h"
#include "log.h"

#include <atomic>
#include <clocale>
#include <exception>
#include <signal.h>
#include <thread> // for std::thread::hardware_concurrency
#include <fstream>
#include <memory>

#if defined(_WIN32)
#include <windows.h>
#endif

static std::function<void(int)> shutdown_handler;
static std::atomic_flag is_terminating = ATOMIC_FLAG_INIT;

// App telemetry globals
static std::atomic<uint64_t> g_requests_routed{0};
static std::atomic<uint64_t> g_requests_success{0};
static std::atomic<uint64_t> g_requests_latency_ms{0};
// Inference-only counters (completions/responses/messages endpoints only)
static std::atomic<uint64_t> g_infer_routed{0};
static std::atomic<uint64_t> g_infer_success{0};
static std::atomic<int32_t> g_infer_processing{0};

static inline void signal_handler(int signal) {
    if (is_terminating.test_and_set()) {
        // in case it hangs, we can force terminate the server by hitting Ctrl+C twice
        // this is for better developer experience, we can remove when the server is stable enough
        fprintf(stderr, "Received second interrupt, terminating immediately.\n");
        exit(1);
    }

    shutdown_handler(signal);
}

// wrapper function that handles exceptions and logs errors
// this is to make sure handler_t never throws exceptions; instead, it returns an error response
static server_http_context::handler_t ex_wrapper(server_http_context::handler_t func) {
    return [func = std::move(func)](const server_http_req & req) -> server_http_res_ptr {
        auto t_start = std::chrono::high_resolution_clock::now();
        g_requests_routed++;
        
        std::string message;
        error_type error;
        try {
            auto res = func(req);
            auto t_end = std::chrono::high_resolution_clock::now();
            g_requests_latency_ms += std::chrono::duration_cast<std::chrono::milliseconds>(t_end - t_start).count();
            if (res->status >= 200 && res->status < 300) {
                g_requests_success++;
            }
            return res;
        } catch (const std::invalid_argument & e) {
            // treat invalid_argument as invalid request (400)
            error = ERROR_TYPE_INVALID_REQUEST;
            message = e.what();
        } catch (const std::exception & e) {
            // treat other exceptions as server error (500)
            error = ERROR_TYPE_SERVER;
            message = e.what();
        } catch (...) {
            error = ERROR_TYPE_SERVER;
            message = "unknown error";
        }

        auto res = std::make_unique<server_http_res>();
        res->status = 500;
        try {
            json error_data = format_error_response(message, error);
            res->status = json_value(error_data, "code", 500);
            res->data = safe_json_to_str({{ "error", error_data }});
            SRV_WRN("got exception: %s\n", res->data.c_str());
        } catch (const std::exception & e) {
            SRV_ERR("got another exception: %s | while handling exception: %s\n", e.what(), message.c_str());
            res->data = "Internal Server Error";
        }
        
        auto t_end = std::chrono::high_resolution_clock::now();
        g_requests_latency_ms += std::chrono::duration_cast<std::chrono::milliseconds>(t_end - t_start).count();
        return res;
    };
}

// Guard to decrement inference processing counter on destruction
struct infer_guard {
    infer_guard() {
        g_infer_processing++;
    }
    ~infer_guard() {
        g_infer_processing--;
    }
};

struct server_http_res_tracked : server_http_res {
    server_http_res_ptr orig;
    std::shared_ptr<infer_guard> guard;
    server_http_res_tracked(server_http_res_ptr orig, std::shared_ptr<infer_guard> guard)
        : orig(std::move(orig)), guard(guard) {
        content_type = this->orig->content_type;
        status = this->orig->status;
        data = this->orig->data;
        headers = this->orig->headers;
        
        if (this->orig->next) {
            // Keep guard alive inside the streaming lambda as well
            next = [orig_next = this->orig->next, guard](std::string & chunk) -> bool {
                return orig_next(chunk);
            };
        }
    }
};

// inference wrapper: same as ex_wrapper but also increments inference-only counters
// use this only for completion/response/message endpoints that produce tokens
static server_http_context::handler_t infer_wrapper(server_http_context::handler_t func) {
    return [func = std::move(func)](const server_http_req & req) -> server_http_res_ptr {
        auto t_start = std::chrono::high_resolution_clock::now();
        g_requests_routed++;
        g_infer_routed++;

        std::string message;
        error_type error;
        try {
            auto guard = std::make_shared<infer_guard>();
            auto res = func(req);
            auto t_end = std::chrono::high_resolution_clock::now();
            g_requests_latency_ms += std::chrono::duration_cast<std::chrono::milliseconds>(t_end - t_start).count();
            if (res->status >= 200 && res->status < 300) {
                g_requests_success++;
                g_infer_success++;
            }
            return std::make_unique<server_http_res_tracked>(std::move(res), guard);
        } catch (const std::invalid_argument & e) {
            error = ERROR_TYPE_INVALID_REQUEST;
            message = e.what();
        } catch (const std::exception & e) {
            error = ERROR_TYPE_SERVER;
            message = e.what();
        } catch (...) {
            error = ERROR_TYPE_SERVER;
            message = "unknown error";
        }

        auto res = std::make_unique<server_http_res>();
        res->status = 500;
        try {
            json error_data = format_error_response(message, error);
            res->status = json_value(error_data, "code", 500);
            res->data = safe_json_to_str({{ "error", error_data }});
            SRV_WRN("got exception: %s\n", res->data.c_str());
        } catch (const std::exception & e) {
            SRV_ERR("got another exception: %s | while handling exception: %s\n", e.what(), message.c_str());
            res->data = "Internal Server Error";
        }

        auto t_end = std::chrono::high_resolution_clock::now();
        g_requests_latency_ms += std::chrono::duration_cast<std::chrono::milliseconds>(t_end - t_start).count();
        return res;
    };
}

// satisfies -Wmissing-declarations
int llama_server(int argc, char ** argv);

int llama_server(int argc, char ** argv) {
    std::setlocale(LC_NUMERIC, "C");

    // own arguments required by this example
    common_params params;

    common_init();
    common_log_set_file(common_log_main(), "server.log");

    if (!common_params_parse(argc, argv, params, LLAMA_EXAMPLE_SERVER)) {
        return 1;
    }

    llama_backend_init();
    llama_numa_init(params.numa);

    // note: router mode also accepts -hf remote-preset, so we need to check that first
    if (!params.model.hf_repo.empty()) {
        try {
            common_params_handle_models_params handle_params;
            handle_params.preset_only = true;
            common_params_handle_models(params, LLAMA_EXAMPLE_SERVER, handle_params);
        } catch (const std::exception & e) {
            // ignored for now
        }
    }

    // router server never loads a model and must not touch the GPU
    const bool is_router_server = params.model.path.empty()
                               && params.model.hf_repo.empty();

    // skip device enumeration so the CUDA primary context stays uncreated
    common_params_print_info(params, !is_router_server);

    if (!is_router_server) {
        // validate batch size for embeddings
        // embeddings require all tokens to be processed in a single ubatch
        // see https://github.com/ggml-org/llama.cpp/issues/12836
        if (params.embedding && params.n_batch > params.n_ubatch) {
            SRV_WRN("embeddings enabled with n_batch (%d) > n_ubatch (%d)\n", params.n_batch, params.n_ubatch);
            SRV_WRN("setting n_batch = n_ubatch = %d to avoid assertion failure\n", params.n_ubatch);
            params.n_batch = params.n_ubatch;
        }

        if (params.n_parallel < 0) {
            SRV_INF("%s", "n_parallel is set to auto, using n_parallel = 4 and kv_unified = true\n");

            params.n_parallel = 4;
            params.kv_unified = true;
        }
    }

    // for consistency between server router mode and single-model mode, we set the same model name as alias
    auto model_name = params.model.get_name();
    if (params.model_alias.empty() && !model_name.empty()) {
        params.model_alias.insert(model_name);
    }

    // struct that contains llama context and inference
    server_context ctx_server;

    server_http_context ctx_http;
    if (!ctx_http.init(params)) {
        SRV_ERR("%s", "failed to initialize HTTP server\n");
        return 1;
    }

    //
    // Router
    //

    // register API routes
    server_child child; // only used in non-router mode
    server_routes routes(params, ctx_server);
    server_tools tools;

    std::optional<server_models_routes> models_routes{};
    if (is_router_server) {
        // setup server instances manager
        try {
            models_routes.emplace(params, argc, argv);
        } catch (const std::exception & e) {
            SRV_ERR("failed to initialize router models: %s\n", e.what());
            return 1;
        }

        // proxy handlers
        // note: routes.get_health stays the same
        routes.get_metrics                 = models_routes->proxy_get;
        routes.post_props                  = models_routes->proxy_post;
        routes.post_completions            = models_routes->proxy_post;
        routes.post_completions_oai        = models_routes->proxy_post;
        routes.post_chat_completions       = models_routes->proxy_post;
        routes.post_orchestra_chat_completions = models_routes->proxy_post;
        routes.post_swarm_chat_completions     = models_routes->proxy_post;
        routes.post_control                = models_routes->proxy_post;
        routes.post_responses_oai          = models_routes->proxy_post;
        routes.post_transcriptions_oai     = models_routes->proxy_post;
        routes.post_anthropic_messages     = models_routes->proxy_post;
        routes.post_anthropic_count_tokens = models_routes->proxy_post;
        routes.post_infill                 = models_routes->proxy_post;
        routes.post_embeddings             = models_routes->proxy_post;
        routes.post_embeddings_oai         = models_routes->proxy_post;
        routes.post_rerank                 = models_routes->proxy_post;
        routes.post_tokenize               = models_routes->proxy_post;
        routes.post_detokenize             = models_routes->proxy_post;
        routes.post_apply_template         = models_routes->proxy_post;
        routes.post_chat_completions_tok   = models_routes->proxy_post;
        routes.post_responses_tok_oai      = models_routes->proxy_post;
        routes.get_lora_adapters           = models_routes->proxy_get;
        routes.post_lora_adapters          = models_routes->proxy_post;
        routes.get_slots                   = models_routes->proxy_get;
        routes.post_slots                  = models_routes->proxy_post;

        // custom routes for router
        routes.get_props                   = models_routes->get_router_props;
        routes.get_models                  = models_routes->get_router_models;

        ctx_http.post("/models",               ex_wrapper(models_routes->post_router_models));
        ctx_http.post("/models/load",          ex_wrapper(models_routes->post_router_models_load));
        ctx_http.post("/models/unload",        ex_wrapper(models_routes->post_router_models_unload));
        ctx_http.get ("/models/sse",           ex_wrapper(models_routes->get_router_models_sse));
        ctx_http.del ("/models",               ex_wrapper(models_routes->del_router_models));
        ctx_http.get ("/models/cache-dir",     ex_wrapper(models_routes->get_router_models_cache_dir));
        ctx_http.post("/models/cache-dir",     ex_wrapper(models_routes->post_router_models_cache_dir));
        ctx_http.post("/models/update-ide",    ex_wrapper(models_routes->post_router_models_update_ide));

        // proxy provider /api endpoints to orchestrator on port 8000
        auto proxy_to_orchestrator = [params](const std::string & method, const server_http_req & req) -> server_http_res_ptr {
            std::string proxy_path = req.path;
            if (!req.query_string.empty()) {
                proxy_path += '?' + req.query_string;
            }
            return std::make_unique<server_http_proxy>(
                method,
                "http",
                "127.0.0.1",
                8000,
                proxy_path,
                req.headers,
                req.body,
                req.files,
                req.should_stop,
                params.timeout_read,
                params.timeout_write
            );
        };

        ctx_http.get ("/api/providers",        ex_wrapper([proxy_to_orchestrator](const server_http_req & req) { return proxy_to_orchestrator("GET", req); }));
        ctx_http.post("/api/providers",        ex_wrapper([proxy_to_orchestrator](const server_http_req & req) { return proxy_to_orchestrator("POST", req); }));
        ctx_http.del ("/api/providers/:id",    ex_wrapper([proxy_to_orchestrator](const server_http_req & req) { return proxy_to_orchestrator("DELETE", req); }));
        ctx_http.get ("/api/providers/models", ex_wrapper([proxy_to_orchestrator](const server_http_req & req) { return proxy_to_orchestrator("GET", req); }));

        routes.post_orchestra_chat_completions = [proxy_to_orchestrator](const server_http_req & req) { return proxy_to_orchestrator("POST", req); };
        routes.post_swarm_chat_completions     = [proxy_to_orchestrator](const server_http_req & req) { return proxy_to_orchestrator("POST", req); };
    } else {
        auto not_supported = [](const server_http_req &) -> server_http_res_ptr {
            throw std::invalid_argument("Dynamic model loading is not supported when running as a single-model worker node. Restart the engine without a model to enable router mode.");
        };
        ctx_http.post("/models",               ex_wrapper(not_supported));
        ctx_http.post("/models/load",          ex_wrapper(not_supported));
        ctx_http.post("/models/unload",        ex_wrapper(not_supported));
        ctx_http.get ("/models/sse",           ex_wrapper(not_supported));
        ctx_http.del ("/models",               ex_wrapper(not_supported));
        ctx_http.get ("/models/cache-dir",     ex_wrapper(not_supported));
        ctx_http.post("/models/cache-dir",     ex_wrapper(not_supported));
        ctx_http.post("/models/update-ide",    ex_wrapper(not_supported));
    }
    ctx_http.get ("/api/logs/stream",          ex_wrapper([](const server_http_req & req) -> server_http_res_ptr {
        auto res = std::make_unique<server_http_res>();
        res->status = 200;
        res->content_type = "text/event-stream";
        
        auto f_ptr = std::make_shared<std::ifstream>("server.log", std::ios::binary);
        if (f_ptr->is_open()) {
            f_ptr->seekg(0, std::ios::end);
            auto file_size = f_ptr->tellg();
            auto chunk_size = 8192;
            if (file_size > chunk_size) {
                f_ptr->seekg(file_size - (std::streamoff)chunk_size);
            } else {
                f_ptr->seekg(0);
            }
            if (file_size > chunk_size) {
                std::string dummy;
                std::getline(*f_ptr, dummy);
            }
        }

        auto sent_init = std::make_shared<bool>(false);

        res->next = [f_ptr, sent_init, &req](std::string & output) -> bool {
            if (req.should_stop()) {
                return false;
            }
            
            if (!f_ptr->is_open()) {
                f_ptr->open("server.log", std::ios::binary);
                if (!f_ptr->is_open()) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(500));
                    output = "";
                    return true;
                }
            }

            if (!*sent_init) {
                std::string line;
                std::vector<std::string> init_lines;
                while (std::getline(*f_ptr, line)) {
                    init_lines.push_back(line);
                }
                if (init_lines.size() > 50) {
                    init_lines.erase(init_lines.begin(), init_lines.end() - 50);
                }
                std::string tail_data;
                for (const auto & l : init_lines) {
                    if (!l.empty()) {
                        tail_data += "data: " + l + "\n\n";
                    }
                }
                output = tail_data;
                *sent_init = true;
                return true;
            }

            std::string line;
            if (std::getline(*f_ptr, line)) {
                output = "data: " + line + "\n\n";
                return true;
            }

            if (f_ptr->eof()) {
                f_ptr->clear();
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            output = "";
            return true;
        };
        return res;
    }));

    ctx_http.get ("/health",                   ex_wrapper(routes.get_health)); // public endpoint (no API key check)
    ctx_http.get ("/v1/health",                ex_wrapper(routes.get_health)); // public endpoint (no API key check)
    ctx_http.get ("/metrics",                  ex_wrapper(routes.get_metrics));
    ctx_http.get ("/telemetry/app",            [](const server_http_req &) -> server_http_res_ptr {
        auto res = std::make_unique<server_http_res>();
        json data = {
            {"requestsRouted",  g_requests_routed.load()},
            {"requestsSuccess", g_requests_success.load()},
            {"latencyMs",       g_requests_latency_ms.load()},
            {"inferRouted",     g_infer_routed.load()},
            {"inferSuccess",    g_infer_success.load()},
            {"inferProcessing", g_infer_processing.load()}
        };
        res->data = data.dump();
        return res;
    });
    ctx_http.get ("/telemetry/sysinfo",        [](const server_http_req &) -> server_http_res_ptr {
        static std::string last_sysinfo = "{}";
        auto res = std::make_unique<server_http_res>();
        
        const char* temp_dir = std::getenv("TEMP");
        std::string sysinfo_path = temp_dir ? std::string(temp_dir) + "\\llama_sysinfo.json" : "sysinfo.json";
        std::ifstream file(sysinfo_path);
        if (file.is_open()) {
            std::stringstream buffer;
            buffer << file.rdbuf();
            last_sysinfo = buffer.str();
        }
        res->data = last_sysinfo;
        return res;
    });
    ctx_http.get ("/props",                    ex_wrapper(routes.get_props));
    ctx_http.post("/props",                    ex_wrapper(routes.post_props));
    ctx_http.get ("/models",                   ex_wrapper(routes.get_models)); // public endpoint (no API key check)
    ctx_http.get ("/v1/models",                ex_wrapper(routes.get_models)); // public endpoint (no API key check)
    ctx_http.post("/completion",               infer_wrapper(routes.post_completions)); // legacy
    ctx_http.post("/completions",              infer_wrapper(routes.post_completions));
    ctx_http.post("/v1/completions",           infer_wrapper(routes.post_completions_oai));
    ctx_http.post("/chat/completions",         infer_wrapper(routes.post_chat_completions));
    ctx_http.post("/v1/chat/completions",      infer_wrapper(routes.post_chat_completions));
    ctx_http.post("/v1/orchestra",                  infer_wrapper(routes.post_orchestra_chat_completions));
    ctx_http.post("/v1/orchestra/chat/completions", infer_wrapper(routes.post_orchestra_chat_completions));
    ctx_http.post("/v1/swarm",                      infer_wrapper(routes.post_swarm_chat_completions));
    ctx_http.post("/v1/swarm/chat/completions",     infer_wrapper(routes.post_swarm_chat_completions));
    ctx_http.post("/v1/chat/completions/control", ex_wrapper(routes.post_control));
    ctx_http.post("/v1/responses",             ex_wrapper(routes.post_responses_oai));
    ctx_http.post("/responses",                ex_wrapper(routes.post_responses_oai));
    ctx_http.post("/v1/audio/transcriptions",  ex_wrapper(routes.post_transcriptions_oai));
    ctx_http.post("/audio/transcriptions",     ex_wrapper(routes.post_transcriptions_oai));
    ctx_http.post("/v1/messages",              ex_wrapper(routes.post_anthropic_messages)); // anthropic messages API
    ctx_http.post("/infill",                   ex_wrapper(routes.post_infill));
    ctx_http.post("/embedding",                ex_wrapper(routes.post_embeddings)); // legacy
    ctx_http.post("/embeddings",               ex_wrapper(routes.post_embeddings));
    ctx_http.post("/v1/embeddings",            ex_wrapper(routes.post_embeddings_oai));
    ctx_http.post("/rerank",                   ex_wrapper(routes.post_rerank));
    ctx_http.post("/reranking",                ex_wrapper(routes.post_rerank));
    ctx_http.post("/v1/rerank",                ex_wrapper(routes.post_rerank));
    ctx_http.post("/v1/reranking",             ex_wrapper(routes.post_rerank));
    ctx_http.post("/tokenize",                 ex_wrapper(routes.post_tokenize));
    ctx_http.post("/detokenize",               ex_wrapper(routes.post_detokenize));
    ctx_http.post("/apply-template",           ex_wrapper(routes.post_apply_template));
    // token counting
    ctx_http.post("/chat/completions/input_tokens",    ex_wrapper(routes.post_chat_completions_tok));
    ctx_http.post("/v1/chat/completions/input_tokens", ex_wrapper(routes.post_chat_completions_tok));
    ctx_http.post("/responses/input_tokens",           ex_wrapper(routes.post_responses_tok_oai));
    ctx_http.post("/v1/responses/input_tokens",        ex_wrapper(routes.post_responses_tok_oai));
    ctx_http.post("/v1/messages/count_tokens",         ex_wrapper(routes.post_anthropic_count_tokens)); // anthropic token counting
    // LoRA adapters hotswap
    ctx_http.get ("/lora-adapters",            ex_wrapper(routes.get_lora_adapters));
    ctx_http.post("/lora-adapters",            ex_wrapper(routes.post_lora_adapters));
    // Save & load slots
    ctx_http.get ("/slots",                    ex_wrapper(routes.get_slots));
    ctx_http.post("/slots/:id_slot",           ex_wrapper(routes.post_slots));

    // Google Cloud Platform (Vertex AI) compat
    ctx_http.register_gcp_compat();

    // CORS proxy (EXPERIMENTAL, only used by the Web UI for MCP)
    if (params.ui_mcp_proxy) {
        SRV_WRN("%s", "-----------------\n");
        SRV_WRN("%s", "CORS proxy is enabled, do not expose server to untrusted environments\n");
        SRV_WRN("%s", "This feature is EXPERIMENTAL and may be removed or changed in future versions\n");
        SRV_WRN("%s", "-----------------\n");
        ctx_http.get ("/cors-proxy",      ex_wrapper(proxy_handler_get));
        ctx_http.post("/cors-proxy",      ex_wrapper(proxy_handler_post));
    }
    // EXPERIMENTAL built-in tools
    if (!params.server_tools.empty()) {
        try {
            tools.setup(params.server_tools);
        } catch (const std::exception & e) {
            SRV_ERR("tools setup failed: %s\n", e.what());
            return 1;
        }
        SRV_WRN("%s", "-----------------\n");
        SRV_WRN("%s", "Built-in tools are enabled, do not expose server to untrusted environments\n");
        SRV_WRN("%s", "This feature is EXPERIMENTAL and may be changed in the future\n");
        SRV_WRN("%s", "-----------------\n");
        ctx_http.get ("/tools",           ex_wrapper(tools.handle_get));
        ctx_http.post("/tools",           ex_wrapper(tools.handle_post));
    }

    //
    // Handle downloading model
    //

    if (child.is_child() && child.get_mode() == SERVER_CHILD_MODE_DOWNLOAD) {
        return child.run_download(params);
    } else if (!is_router_server) {
        // single-model mode (NOT spawned by router)
        common_params_handle_models(params, LLAMA_EXAMPLE_SERVER, {});
    }

    //
    // Start the server
    //

    std::function<void()> clean_up;

    if (is_router_server) {
        SRV_INF("%s", "starting router server, no model will be loaded in this process\n");

        clean_up = [&models_routes]() {
            SRV_INF("%s: cleaning up before exit...\n", __func__);
            if (models_routes.has_value()) {
                models_routes->stopping.store(true); // maybe redundant, but just to be safe
                models_routes->models.unload_all();
            }
            llama_backend_free();
        };

        if (!ctx_http.start()) {
            clean_up();
            SRV_ERR("%s", "exiting due to HTTP server error\n");
            return 1;
        }
        ctx_http.is_ready.store(true);

        shutdown_handler = [&](int) {
            if (models_routes.has_value()) {
                // important to disconnect any SSE clients
                models_routes->stopping.store(true);
            }
            ctx_http.stop();
        };

    } else {
        // setup clean up function, to be called before exit
        clean_up = [&ctx_http, &ctx_server]() {
            SRV_INF("%s: cleaning up before exit...\n", __func__);
            ctx_http.stop();
            ctx_server.terminate();
            llama_backend_free();
        };

        // start the HTTP server before loading the model to be able to serve /health requests
        if (!ctx_http.start()) {
            clean_up();
            SRV_ERR("%s", "exiting due to HTTP server error\n");
            return 1;
        }

        // setup communication child --> router if necessary
        if (child.is_child()) {
            ctx_server.set_state_callback([&](server_state state, json payload) {
                child.notify_to_router(server_state_to_str(state), payload);
            });
        }

        // load the model
        SRV_INF("%s", "loading model\n");

        if (!ctx_server.load_model(params)) {
            clean_up();
            if (ctx_http.thread.joinable()) {
                ctx_http.thread.join();
            }
            SRV_ERR("%s", "exiting due to model loading error\n");
            return 1;
        }

        routes.update_meta(ctx_server);
        ctx_http.is_ready.store(true);

        SRV_INF("%s", "model loaded\n");

        shutdown_handler = [&](int) {
            // this will unblock start_loop()
            ctx_server.terminate();
        };
    }

    // TODO: refactor in common/console
#if defined (__unix__) || (defined (__APPLE__) && defined (__MACH__))
    struct sigaction sigint_action;
    sigint_action.sa_handler = signal_handler;
    sigemptyset (&sigint_action.sa_mask);
    sigint_action.sa_flags = 0;
    sigaction(SIGINT, &sigint_action, NULL);
    sigaction(SIGTERM, &sigint_action, NULL);
#elif defined (_WIN32)
    auto console_ctrl_handler = +[](DWORD ctrl_type) -> BOOL {
        return (ctrl_type == CTRL_C_EVENT) ? (signal_handler(SIGINT), true) : false;
    };
    SetConsoleCtrlHandler(reinterpret_cast<PHANDLER_ROUTINE>(console_ctrl_handler), true);
#endif

    if (is_router_server) {
        SRV_INF("router server is listening on %s\n", ctx_http.listening_address.c_str());
        SRV_WRN("%s", "NOTE: router mode is experimental\n");
        SRV_WRN("%s", "      it is not recommended to use this mode in untrusted environments\n");

        if (!params.models_preset_hf.empty()) {
            SRV_WRN(      "NOTE: using preset.ini from HF repo '%s'\n", params.models_preset_hf.c_str());
            SRV_WRN("%s", "      please only use presets that you can trust! Unknown presets may be unsafe\n");
        }

        if (ctx_http.thread.joinable()) {
            ctx_http.thread.join(); // keep the main thread alive
        }

        // when the HTTP server stops, clean up and exit
        clean_up();
    } else {
        SRV_INF("server is listening on %s\n", ctx_http.listening_address.c_str());

        // optionally, notify router server that this instance is ready
        std::thread monitor_thread;
        if (child.is_child()) {
            monitor_thread = child.setup(shutdown_handler);
            child.notify_to_router(server_state_to_str(SERVER_STATE_READY), routes.get_model_info());
        }

        // this call blocks the main thread until queue_tasks.terminate() is called
        ctx_server.start_loop();

        clean_up();
        if (ctx_http.thread.joinable()) {
            ctx_http.thread.join();
        }
        if (monitor_thread.joinable()) {
            monitor_thread.join();
        }

        auto * ll_ctx = ctx_server.get_llama_context();
        if (ll_ctx != nullptr) {
            common_memory_breakdown_print(ll_ctx);
        }
    }

    return 0;
}
