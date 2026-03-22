package nz.amo.app;

import android.content.res.AssetManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.GeneratedAudio;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeKokoro")
public class NativeKokoro extends Plugin {
    private static final String MODEL_DIR = "sherpa/kokoro-en-v0_19";
    private static final String MODEL_FILE = MODEL_DIR + "/model.onnx";
    private static final String VOICES_FILE = MODEL_DIR + "/voices.bin";
    private static final String TOKENS_FILE = MODEL_DIR + "/tokens.txt";
    private static final String DATA_DIR = MODEL_DIR + "/espeak-ng-data";
    private static final String DATA_DIR_NAME = "espeak-ng-data";

    private final Object lock = new Object();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private OfflineTts kokoro;
    private AudioTrack audioTrack;
    private int speakerId = 10;
    private float speed = 1.0f;
    private String copiedDataDirPath = "";
    private int activeRequestId = 0;

    @PluginMethod
    public void initialize(PluginCall call) {
        speakerId = call.getInt("speakerId", speakerId);
        speed = call.getFloat("speed", speed);

        JSObject result = new JSObject();
        if (!hasRequiredAssets()) {
            result.put("available", false);
            result.put("reason", "Missing Kokoro assets under android/app/src/main/assets/" + MODEL_DIR);
            call.resolve(result);
            return;
        }

        try {
            ensureKokoroLoaded();
            result.put("available", kokoro != null);
            if (kokoro != null) {
                result.put("sampleRate", kokoro.sampleRate());
                result.put("speakerId", speakerId);
            }
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Failed to initialize Kokoro TTS.", ex);
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        int requestedSpeakerId = call.getInt("speakerId", speakerId);
        float requestedSpeed = call.getFloat("speed", speed);

        if (text.isEmpty()) {
            call.reject("Missing text.");
            return;
        }

        if (!hasRequiredAssets()) {
            call.reject("Missing Kokoro assets under android/app/src/main/assets/" + MODEL_DIR);
            return;
        }

        call.setKeepAlive(true);
        saveCall(call);
        final String callbackId = call.getCallbackId();
        final int requestId;

        synchronized (lock) {
            activeRequestId += 1;
            requestId = activeRequestId;
        }

        executor.execute(() -> {
            try {
                ensureKokoroLoaded();
                streamAudio(callbackId, requestId, text, requestedSpeakerId, requestedSpeed);
            } catch (Exception ex) {
                bridge.executeOnMainThread(() -> {
                    PluginCall savedCall = bridge.getSavedCall(callbackId);
                    if (savedCall != null) {
                        savedCall.reject("Failed to synthesize with Kokoro.", ex);
                        bridge.releaseCall(savedCall);
                    }
                });
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synchronized (lock) {
            activeRequestId += 1;
        }
        stopPlayback();
        call.resolve();
    }

    private void ensureKokoroLoaded() throws IOException {
        synchronized (lock) {
            if (kokoro != null) {
                return;
            }

            AssetManager assets = getContext().getAssets();
            copiedDataDirPath = ensureDataDirCopied(assets);
            OfflineTtsKokoroModelConfig kokoroModel = new OfflineTtsKokoroModelConfig();
            kokoroModel.setModel(MODEL_FILE);
            kokoroModel.setVoices(VOICES_FILE);
            kokoroModel.setTokens(TOKENS_FILE);
            kokoroModel.setDataDir(copiedDataDirPath);
            kokoroModel.setLexicon("");
            kokoroModel.setLang("en-US");
            kokoroModel.setDictDir("");
            kokoroModel.setLengthScale(1.0f);

            OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
            modelConfig.setKokoro(kokoroModel);
            modelConfig.setNumThreads(2);
            modelConfig.setDebug(false);
            modelConfig.setProvider("cpu");

            OfflineTtsConfig config = new OfflineTtsConfig();
            config.setModel(modelConfig);
            config.setMaxNumSentences(1);
            config.setSilenceScale(0.05f);

            kokoro = new OfflineTts(assets, config);
        }
    }

    private String ensureDataDirCopied(AssetManager assets) throws IOException {
        File targetDir = new File(getContext().getFilesDir(), MODEL_DIR + "/" + DATA_DIR_NAME);
        File marker = new File(targetDir, "phontab");
        if (!marker.exists()) {
            copyAssetDirectory(assets, DATA_DIR, targetDir);
        }

        return targetDir.getAbsolutePath();
    }

    private void copyAssetDirectory(AssetManager assets, String assetPath, File targetDir) throws IOException {
        String[] children = assets.list(assetPath);
        if (children == null || children.length == 0) {
            copyAssetFile(assets, assetPath, targetDir);
            return;
        }

        if (!targetDir.exists() && !targetDir.mkdirs()) {
            throw new IOException("Failed to create directory: " + targetDir.getAbsolutePath());
        }

        for (String child : children) {
            String childAssetPath = assetPath + "/" + child;
            File childTarget = new File(targetDir, child);
            copyAssetDirectory(assets, childAssetPath, childTarget);
        }
    }

    private void copyAssetFile(AssetManager assets, String assetPath, File targetFile) throws IOException {
        File parent = targetFile.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Failed to create directory: " + parent.getAbsolutePath());
        }

        try (InputStream input = assets.open(assetPath); FileOutputStream output = new FileOutputStream(targetFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
        }
    }

    private boolean hasRequiredAssets() {
        try {
            AssetManager assets = getContext().getAssets();
            assets.open(MODEL_FILE).close();
            assets.open(VOICES_FILE).close();
            assets.open(TOKENS_FILE).close();
            String[] dataEntries = assets.list(DATA_DIR);
            return dataEntries != null && dataEntries.length > 0;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void streamAudio(String callbackId, int requestId, String text, int requestedSpeakerId, float requestedSpeed) {
        OfflineTts localKokoro;
        synchronized (lock) {
            if (kokoro == null) {
                throw new IllegalStateException("Kokoro is not initialized.");
            }
            localKokoro = kokoro;
        }

        final int sampleRate = localKokoro.sampleRate();
        int minBufferSize = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        int bufferSize = Math.max(minBufferSize * 2, sampleRate);

        AudioTrack track;
        synchronized (lock) {
            stopPlaybackLocked();
            track = createAudioTrack(sampleRate, bufferSize);
            audioTrack = track;
        }

        track.play();

        GeneratedAudio audio = localKokoro.generate(text, requestedSpeakerId, requestedSpeed);
        float[] allSamples = audio.getSamples();
        final int totalSamples = allSamples.length;
        int offset = 0;

        while (offset < totalSamples) {
            synchronized (lock) {
                if (requestId != activeRequestId || audioTrack != track) {
                    break;
                }
            }

            int chunkSize = Math.min(8192, totalSamples - offset);
            short[] pcm = new short[chunkSize];
            for (int i = 0; i < chunkSize; i++) {
                float clamped = Math.max(-1.0f, Math.min(1.0f, allSamples[offset + i]));
                pcm[i] = (short) Math.round(clamped * 32767.0f);
            }

            int written = track.write(pcm, 0, chunkSize);
            if (written > 0) {
                offset += written;
            }

            try {
                Thread.sleep(2L);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                break;
            }
        }

        synchronized (lock) {
            if (audioTrack == track) {
                stopPlaybackLocked();
            }
        }

        bridge.executeOnMainThread(() -> {
            PluginCall savedCall = bridge.getSavedCall(callbackId);
            if (savedCall != null) {
                savedCall.resolve();
                bridge.releaseCall(savedCall);
            }
        });
    }

    private AudioTrack createAudioTrack(int sampleRate, int bufferSize) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(bufferSize)
                .build();
        }

        return new AudioTrack(
            android.media.AudioManager.STREAM_MUSIC,
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
            AudioTrack.MODE_STREAM
        );
    }

    private void stopPlayback() {
        synchronized (lock) {
            stopPlaybackLocked();
        }
    }

    private void stopPlaybackLocked() {
        if (audioTrack != null) {
            try {
                audioTrack.stop();
            } catch (Exception ignored) {}
            try {
                audioTrack.release();
            } catch (Exception ignored) {}
            audioTrack = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopPlayback();
        synchronized (lock) {
            if (kokoro != null) {
                kokoro.release();
                kokoro = null;
            }
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
