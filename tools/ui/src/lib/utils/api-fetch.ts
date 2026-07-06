import { base } from '$app/paths';
import { getJsonHeaders, getAuthHeaders } from './api-headers';
import { UrlProtocol } from '$lib/enums';
import { HTTP_CODE_TO_STRING, ERROR_MESSAGES } from '$lib/constants/error';

/**
 * API Fetch Utilities
 *
 * Provides common fetch patterns used across services:
 * - Automatic JSON headers
 * - Error handling with proper error messages
 * - Base path resolution
 */

export interface ApiFetchOptions extends Omit<RequestInit, 'headers'> {
	/**
	 * Use auth-only headers (no Content-Type).
	 * Default: false (uses JSON headers with Content-Type: application/json)
	 */
	authOnly?: boolean;
	/**
	 * Additional headers to merge with default headers.
	 */
	headers?: Record<string, string>;
}

/**
 * Fetch JSON data from an API endpoint with standard headers and error handling.
 *
 * @param path - API path (will be prefixed with base path)
 * @param options - Fetch options with additional authOnly flag
 * @returns Parsed JSON response
 * @throws Error with formatted message on failure
 *
 * @example
 * ```typescript
 * // GET request
 * const models = await apiFetch<ApiModelListResponse>('/v1/models');
 *
 * // POST request
 * const result = await apiFetch<ApiResponse>('/models/load', {
 *   method: 'POST',
 *   body: JSON.stringify({ model: 'gpt-4' })
 * });
 * ```
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
	const { authOnly = false, headers: customHeaders, ...fetchOptions } = options;

	const baseHeaders = authOnly ? getAuthHeaders() : getJsonHeaders();
	const headers = { ...baseHeaders, ...customHeaders };

	const url =
		path.startsWith(UrlProtocol.HTTP) || path.startsWith(UrlProtocol.HTTPS)
			? path
			: `${base}${path}`;

	const response = await fetchWithRetry(url, { ...fetchOptions, headers });

	if (!response.ok) {
		const errorMessage = await parseErrorMessage(response);
		throw new Error(errorMessage);
	}

	return response.json() as Promise<T>;
}

/**
 * Fetch with URL constructed from base URL and query parameters.
 *
 * @param basePath - Base API path
 * @param params - Query parameters to append
 * @param options - Fetch options
 * @returns Parsed JSON response
 *
 * @example
 * ```typescript
 * const props = await apiFetchWithParams<ApiProps>('./props', {
 *   model: 'gpt-4',
 *   autoload: 'false'
 * });
 * ```
 */
export async function apiFetchWithParams<T>(
	basePath: string,
	params: Record<string, string | null | undefined>,
	options: ApiFetchOptions = {}
): Promise<T> {
	const url = new URL(basePath, window.location.href);

	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, value);
		}
	}

	const { authOnly = false, headers: customHeaders, ...fetchOptions } = options;

	const baseHeaders = authOnly ? getAuthHeaders() : getJsonHeaders();
	const headers = { ...baseHeaders, ...customHeaders };

	const response = await fetchWithRetry(url.toString(), { ...fetchOptions, headers });

	if (!response.ok) {
		const errorMessage = await parseErrorMessage(response);
		throw new Error(errorMessage);
	}

	return response.json() as Promise<T>;
}

/**
 * Shared fetch helper with retry + exponential backoff.
 * Fast-fails on AbortError; uses an abort-aware sleep to avoid stalling cancelled requests.
 */
async function fetchWithRetry(url: string | URL, init: RequestInit): Promise<Response> {
	let retries = 3;
	let backoff = 1000;

	while (true) {
		try {
			return await fetch(url, init);
		} catch (e) {
			// Fast-fail on abort - never retry an intentionally cancelled request
			if (e instanceof DOMException && e.name === 'AbortError') throw e;
			if (e instanceof Error && e.name === 'AbortError') throw e;

			if (retries === 0) {
				throw new Error(beautifyNetworkError(e));
			}
			retries--;

			// Abort-aware sleep: cancel the wait immediately if the signal fires
			await new Promise<void>((resolve, reject) => {
				const id = setTimeout(resolve, backoff);
				init.signal?.addEventListener(
					'abort',
					() => {
						clearTimeout(id);
						reject(
							init.signal!.reason instanceof Error
								? init.signal!.reason
								: new DOMException('Aborted', 'AbortError')
						);
					},
					{ once: true }
				);
			});
			backoff *= 2;
		}
	}
}


/**
 * POST JSON data to an API endpoint.
 *
 * @param path - API path
 * @param body - Request body (will be JSON stringified)
 * @param options - Additional fetch options
 * @returns Parsed JSON response
 */
export async function apiPost<T, B = unknown>(
	path: string,
	body: B,
	options: ApiFetchOptions = {}
): Promise<T> {
	return apiFetch<T>(path, {
		method: 'POST',
		body: JSON.stringify(body),
		...options
	});
}

/**
 * Parse error message from a failed response.
 * Tries to extract error message from JSON body, falls back to status text.
 */
async function parseErrorMessage(response: Response): Promise<string> {
	try {
		const errorData = await response.json();
		let message = '';
		if (errorData?.error?.message) {
			message = errorData.error.message;
		} else if (errorData?.error && typeof errorData.error === 'string') {
			message = errorData.error;
		} else if (errorData?.message) {
			message = errorData.message;
		}

		if (message) {
			if (response.status === 404 && message === 'File Not Found' && response.url.includes('/models')) {
				return 'Dynamic model loading is not supported when running as a single-model worker node. Restart the engine without a local model to enable router mode.';
			}
			return message;
		}
	} catch {
		// JSON parsing failed, use status text
	}

	const httpErrorStr = HTTP_CODE_TO_STRING[response.status];
	if (httpErrorStr) {
		return httpErrorStr;
	}

	return `${ERROR_MESSAGES.HTTP.GENERIC}: ${response.status} ${response.statusText}`;
}

/**
 * Converts a network issue into a human-readable message.
 * @param throwable - The throwable raised during fetch operation
 * @returns Error in an human-readable format
 */
function beautifyNetworkError(throwable: unknown): string {
	let message;
	if (throwable instanceof Error) {
		message = throwable.message;
		if (throwable.name === 'TypeError' && message.includes('fetch')) {
			return ERROR_MESSAGES.NETWORK.UNREACHABLE;
		}
	} else {
		message = String(throwable);
	}

	if (message.includes('ECONNREFUSED')) {
		return ERROR_MESSAGES.NETWORK.REFUSED;
	} else if (message.includes('ENOTFOUND')) {
		return ERROR_MESSAGES.NETWORK.NXDOMAIN;
	} else if (message.includes('ETIMEDOUT')) {
		return ERROR_MESSAGES.NETWORK.TIMEOUT;
	}

	return `${ERROR_MESSAGES.NETWORK.GENERIC} (${message})`;
}
