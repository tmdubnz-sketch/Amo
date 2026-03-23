package nz.amo.app;

import android.Manifest;
import android.content.res.AssetManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.HomophoneReplacerConfig;
import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizerResult;
import com.k2fsa.sherpa.onnx.OfflineStream;
import com.k2fsa.sherpa.onnx.SileroVadModelConfig;
import com.k2fsa.sherpa.onnx.SpeechSegment;
import com.k2fsa.sherpa.onnx.Vad;
import com.k2fsa.sherpa.onnx.VadModelConfig;

import java.io.IOException;

@CapacitorPlugin(
    name = "NativeSTT",
    permissions = {
        @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone")
    }
)
public class NativeSTT extends Plugin {
    private static final int SAMPLE_RATE = 16000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    private static final int BUFFER_SAMPLES = 512;
    private static final String VAD_MODEL = "sherpa/silero_vad.onnx";
    private static final String MODEL_DIR_TINY = "sherpa/moonshine-tiny-en";
    private static final String MODEL_DIR_BASE = "sherpa/moonshine-base-en";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object recognizerLock = new Object();

    private AudioRecord audioRecord;
    private Thread captureThread;
    private Vad vad;
    private OfflineRecognizer recognizer;

    private volatile boolean running = false;
    private volatile boolean recording = false;
    private volatile boolean transcribing = false;
    private volatile boolean speechDetected = false;
    private volatile boolean vadActive = false;
    private volatile double level = 0;
    private volatile String currentTranscript = "";
    private int sessionId = 0;
    private String activeModelDir = MODEL_DIR_TINY;
    private long lastEmitAtMs = 0;
    private String lastEmitSignature = "";

    @PluginMethod()
    public void initialize(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", hasRequiredAssets());
        call.resolve(result);
    }

    @PluginMethod()
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        PermissionState permissionState = getPermissionState("microphone");
        result.put("microphone", permissionState == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod()
    public void requestPermissions(PluginCall call) {
        requestPermissionForAlias("microphone", call, "microphonePermCallback");
    }

    @PermissionCallback
    private void microphonePermCallback(PluginCall call) {
        JSObject result = new JSObject();
        PermissionState permissionState = getPermissionState("microphone");
        result.put("microphone", permissionState == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod()
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission not granted.");
            return;
        }

        if (!hasRequiredAssets()) {
            call.reject("Sherpa model assets are missing from android/app/src/main/assets/sherpa.");
            return;
        }

        try {
            ensureSherpaReady();
            stopCapture(false);
            resetState();
            sessionId++;
            final int expectedSessionId = sessionId;

            int minBufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
            int bufferSize = Math.max(minBufferSize, BUFFER_SAMPLES * 2);
            
            // Use VOICE_COMMUNICATION for automatic echo cancellation, noise suppression, AGC
            audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize * 2
            );

            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IllegalStateException("AudioRecord failed to initialize.");
            }

            // Enable additional audio effects for echo cancellation
            int sessionId = audioRecord.getAudioSessionId();
            if (AcousticEchoCanceler.isAvailable()) {
                AcousticEchoCanceler aec = AcousticEchoCanceler.create(sessionId);
                if (aec != null) {
                    aec.setEnabled(true);
                }
            }
            if (NoiseSuppressor.isAvailable()) {
                NoiseSuppressor ns = NoiseSuppressor.create(sessionId);
                if (ns != null) {
                    ns.setEnabled(true);
                }
            }

            audioRecord.startRecording();
            running = true;
            recording = true;
            emitSessionState("starting", null, null);
            emitSessionState("listening", null, null);

            captureThread = new Thread(() -> captureLoop(expectedSessionId), "SherpaCapture");
            captureThread.start();
            call.resolve();
        } catch (Exception ex) {
            stopCapture(false);
            emitSessionState("error", null, ex.getMessage());
            call.reject("Failed to start sherpa STT.", ex);
        }
    }

    @PluginMethod()
    public void stop(PluginCall call) {
        stopCapture(true);
        call.resolve();
    }

    private void ensureSherpaReady() throws IOException {
        if (vad != null && recognizer != null) {
            return;
        }

        AssetManager assets = getContext().getAssets();
        activeModelDir = getPreferredModelDir();

        SileroVadModelConfig sileroConfig = new SileroVadModelConfig();
        sileroConfig.setModel(VAD_MODEL);
        sileroConfig.setThreshold(0.5f);
        sileroConfig.setMinSilenceDuration(0.3f);
        sileroConfig.setMinSpeechDuration(0.2f);
        sileroConfig.setWindowSize(512);
        sileroConfig.setMaxSpeechDuration(20.0f);

        VadModelConfig vadConfig = new VadModelConfig();
        vadConfig.setSileroVadModelConfig(sileroConfig);
        vadConfig.setSampleRate(SAMPLE_RATE);
        vadConfig.setNumThreads(2);
        vadConfig.setProvider("cpu");
        vadConfig.setDebug(false);
        vad = new Vad(assets, vadConfig);

        OfflineMoonshineModelConfig moonshineConfig = new OfflineMoonshineModelConfig();
        moonshineConfig.setEncoder(activeModelDir + "/encoder_model.ort");
        moonshineConfig.setMergedDecoder(activeModelDir + "/decoder_model_merged.ort");

        OfflineModelConfig modelConfig = new OfflineModelConfig();
        modelConfig.setMoonshine(moonshineConfig);
        modelConfig.setTokens(activeModelDir + "/tokens.txt");
        modelConfig.setNumThreads(2);
        modelConfig.setProvider("cpu");

        FeatureConfig featureConfig = new FeatureConfig();
        featureConfig.setSampleRate(SAMPLE_RATE);
        featureConfig.setFeatureDim(80);
        featureConfig.setDither(0.0f);

        OfflineRecognizerConfig recognizerConfig = new OfflineRecognizerConfig();
        recognizerConfig.setFeatConfig(featureConfig);
        recognizerConfig.setModelConfig(modelConfig);
        recognizerConfig.setHr(new HomophoneReplacerConfig());
        recognizerConfig.setDecodingMethod("greedy_search");
        recognizerConfig.setMaxActivePaths(4);

        recognizer = new OfflineRecognizer(assets, recognizerConfig);
    }

    private void captureLoop(int expectedSessionId) {
        short[] buffer = new short[BUFFER_SAMPLES];

        while (running && expectedSessionId == sessionId && audioRecord != null) {
            int read = audioRecord.read(buffer, 0, buffer.length);
            if (read <= 0) {
                continue;
            }

            float[] samples = new float[read];
            double sumSquares = 0;
            for (int i = 0; i < read; i++) {
                samples[i] = buffer[i] / 32768.0f;
                sumSquares += samples[i] * samples[i];
            }

            level = Math.sqrt(sumSquares / read);
            speechDetected = vad != null && vad.isSpeechDetected();

            if (vad != null) {
                vad.acceptWaveform(samples);
                vadActive = vad.isSpeechDetected();
            }

            emitSessionState(transcribing ? "transcribing" : "listening", null, null);

            while (running && vad != null && !vad.empty() && expectedSessionId == sessionId) {
                SpeechSegment segment = vad.front();
                vad.pop();
                vadActive = false;
                speechDetected = true;
                transcribing = true;
                emitSessionState("transcribing", null, null);
                decodeSegmentAsync(expectedSessionId, segment.getSamples());
            }
        }
    }

    private void decodeSegmentAsync(int expectedSessionId, float[] samples) {
        new Thread(() -> {
            try {
                String text;
                synchronized (recognizerLock) {
                    if (recognizer == null) {
                        throw new IllegalStateException("Sherpa recognizer is not initialized.");
                    }
                    OfflineStream stream = recognizer.createStream();
                    stream.acceptWaveform(samples, SAMPLE_RATE);
                    recognizer.decode(stream);
                    OfflineRecognizerResult result = recognizer.getResult(stream);
                    text = result.getText() != null ? result.getText().trim() : "";
                    stream.release();
                }

                final String finalText = text;
                runOnMainThread(() -> {
                    if (expectedSessionId != sessionId) {
                        return;
                    }
                    transcribing = false;
                    if (!finalText.isEmpty()) {
                        currentTranscript = finalText;
                        stopCapture(false);
                        emitSessionState("stopped", finalText, null);
                    } else {
                        emitSessionState("error", null, "Sherpa returned empty transcription.");
                        emitSessionState("listening", null, null);
                    }
                });
            } catch (Exception ex) {
                runOnMainThread(() -> {
                    if (expectedSessionId != sessionId) {
                        return;
                    }
                    transcribing = false;
                    emitSessionState("error", null, ex.getMessage());
                    emitSessionState("listening", null, null);
                });
            }
        }, "SherpaDecode").start();
    }

    private boolean hasRequiredAssets() {
        try {
            AssetManager assets = getContext().getAssets();
            assets.open(VAD_MODEL).close();
            String modelDir = getPreferredModelDir();
            assets.open(modelDir + "/encoder_model.ort").close();
            assets.open(modelDir + "/decoder_model_merged.ort").close();
            assets.open(modelDir + "/tokens.txt").close();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String getPreferredModelDir() {
        AssetManager assets = getContext().getAssets();
        try {
            assets.open(MODEL_DIR_BASE + "/encoder_model.ort").close();
            assets.open(MODEL_DIR_BASE + "/decoder_model_merged.ort").close();
            assets.open(MODEL_DIR_BASE + "/tokens.txt").close();
            return MODEL_DIR_BASE;
        } catch (Exception ignored) {
            return MODEL_DIR_TINY;
        }
    }

    private void emitSessionState(String phase, String finalTranscript, String message) {
        long now = System.currentTimeMillis();
        String signature = phase
            + "|" + recording
            + "|" + transcribing
            + "|" + speechDetected
            + "|" + vadActive
            + "|" + (message != null ? message : "")
            + "|" + (finalTranscript != null ? finalTranscript : "");

        boolean shouldThrottle = finalTranscript == null && message == null && ("listening".equals(phase) || "starting".equals(phase));
        if (shouldThrottle && signature.equals(lastEmitSignature) && (now - lastEmitAtMs) < 250) {
            return;
        }

        JSObject data = new JSObject();
        data.put("phase", phase);
        data.put("transcript", currentTranscript);
        data.put("speechDetected", speechDetected);
        data.put("vadActive", vadActive);
        data.put("recording", recording);
        data.put("transcribing", transcribing);
        data.put("level", round(level));
        data.put("noiseFloor", 0);
        data.put("threshold", 0);
        data.put("backend", "native-sherpa:" + (activeModelDir.endsWith("base-en") ? "moonshine-base" : "moonshine-tiny"));
        if (finalTranscript != null) {
            data.put("finalTranscript", finalTranscript);
        }
        if (message != null) {
            data.put("message", message);
        }
        lastEmitAtMs = now;
        lastEmitSignature = signature;
        notifyListeners("sessionState", data);
    }

    private double round(double value) {
        return Math.round(value * 10000.0) / 10000.0;
    }

    private void stopCapture(boolean notifyStopped) {
        running = false;
        recording = false;
        vadActive = false;

        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (Exception ignored) {}
        }

        if (captureThread != null) {
            try {
                captureThread.join(250);
            } catch (InterruptedException ignored) {}
            captureThread = null;
        }

        if (audioRecord != null) {
            try {
                audioRecord.release();
            } catch (Exception ignored) {}
            audioRecord = null;
        }

        if (vad != null) {
            vad.reset();
        }

        if (notifyStopped) {
            resetState();
            emitSessionState("stopped", null, null);
        }
    }

    private void resetState() {
        transcribing = false;
        speechDetected = false;
        vadActive = false;
        level = 0;
        currentTranscript = "";
        lastEmitAtMs = 0;
        lastEmitSignature = "";
    }

    private void runOnMainThread(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            mainHandler.post(action);
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopCapture(false);
        if (vad != null) {
            vad.release();
            vad = null;
        }
        synchronized (recognizerLock) {
            if (recognizer != null) {
                recognizer.release();
                recognizer = null;
            }
        }
        super.handleOnDestroy();
    }
}
