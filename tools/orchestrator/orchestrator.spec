from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

espeakng_datas = collect_data_files('espeakng_loader')
espeakng_bins = collect_dynamic_libs('espeakng_loader')
kokoro_datas = collect_data_files('kokoro_onnx')
phonemizer_datas = collect_data_files('phonemizer')

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=espeakng_bins,
    datas=[('tts_models/*', 'tts_models')] + espeakng_datas + kokoro_datas + phonemizer_datas,
    hiddenimports=['multipart', 'multipart.multipart', 'kokoro_onnx', 'espeakng_loader', 'phonemizer', 'soundfile', 'faster_whisper'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'torchvision', 'torchaudio', 'xformers', 'bitsandbytes', 'transformers', 'huggingface_hub', 'scipy', 'pandas', 'matplotlib', 'safetensors', 'accelerate', 'tensorboard'],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='orchestrator',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
