package nz.amo.app;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

@CapacitorPlugin(
    name = "NativeSTT",
    permissions = {
        @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone")
    }
)
public class NativeSTT extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private boolean isListening = false;
    private boolean continuous = false;
    private boolean userStopped = false;
    private int sessionId = 0;
    private ArrayList<String> lastPartialMatches = new ArrayList<>();

    private String language = "en-US";
    private boolean partialResults = true;
    private int maxResults = 5;
    private int completeSilenceMillis = 3000;
    private int possibleCompleteSilenceMillis = 2000;
    private int minimumSpeechMillis = 500;

    @PluginMethod()
    public void initialize(PluginCall call) {
        boolean available = SpeechRecognizer.isRecognitionAvailable(getContext());
        JSObject ret = new JSObject();
        ret.put("available", available);
        call.resolve(ret);
    }

    @PluginMethod()
    public void checkPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        PermissionState permissionState = getPermissionState("microphone");
        String state = permissionState == PermissionState.GRANTED ? "granted" : "denied";
        ret.put("microphone", state);
        call.resolve(ret);
    }

    @PluginMethod()
    public void requestPermissions(PluginCall call) {
        requestPermissionForAlias("microphone", call, "microphonePermCallback");
    }

    @PermissionCallback
    private void microphonePermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        PermissionState permissionState = getPermissionState("microphone");
        String state = permissionState == PermissionState.GRANTED ? "granted" : "denied";
        ret.put("microphone", state);
        call.resolve(ret);
    }

    @PluginMethod()
    public void start(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Speech recognition not available on this device.");
            return;
        }

        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission not granted.");
            return;
        }

        language = normalizeLanguage(call.getString("language", "en-US"));
        continuous = call.getBoolean("continuous", false);
        partialResults = call.getBoolean("partialResults", true);
        maxResults = call.getInt("maxResults", 5);
        completeSilenceMillis = call.getInt("completeSilenceMillis", 3000);
        possibleCompleteSilenceMillis = call.getInt("possibleCompleteSilenceMillis", 2000);
        minimumSpeechMillis = call.getInt("minimumSpeechMillis", 500);

        runOnMainThread(() -> {
            try {
                userStopped = false;
                sessionId++;
                int currentSessionId = sessionId;
                stopRecognizerInternal(false);
                beginListeningCycle(currentSessionId);
                call.resolve();
            } catch (Exception ex) {
                stopRecognizerInternal(false);
                call.reject("Failed to start speech recognition.", ex);
            }
        });
    }

    @PluginMethod()
    public void stop(PluginCall call) {
        runOnMainThread(() -> {
            userStopped = true;
            sessionId++;
            stopRecognizerInternal(true);
            call.resolve();
        });
    }

    private void beginListeningCycle(int expectedSessionId) {
        if (userStopped || expectedSessionId != sessionId) {
            return;
        }

        stopRecognizerInternal(false);
        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        recognizer.setRecognitionListener(createRecognitionListener(expectedSessionId));
        recognizer.startListening(buildIntent());
    }

    private RecognitionListener createRecognitionListener(int expectedSessionId) {
        return new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                lastPartialMatches.clear();
                isListening = true;
                android.util.Log.d("NativeSTT", "onReadyForSpeech - ready to listen");
                emitStatus("listening", null);
            }

            @Override
            public void onBeginningOfSpeech() {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                android.util.Log.d("NativeSTT", "onBeginningOfSpeech - user started speaking");
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                if (rmsdB > -10) {
                    android.util.Log.d("NativeSTT", "RMS: " + rmsdB + " dB");
                }
            }

            @Override
            public void onBufferReceived(byte[] buffer) {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                android.util.Log.d(
                    "NativeSTT",
                    "onBufferReceived: " + (buffer != null ? buffer.length : 0) + " bytes"
                );
            }

            @Override
            public void onEndOfSpeech() {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                isListening = false;
                android.util.Log.d("NativeSTT", "onEndOfSpeech");
            }

            @Override
            public void onError(int error) {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                isListening = false;
                android.util.Log.d(
                    "NativeSTT",
                    "onError: " + getErrorText(error) + " (code: " + error + ")"
                );

                if (userStopped) {
                    return;
                }

                if (error == SpeechRecognizer.ERROR_NO_MATCH ||
                    error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    if (!lastPartialMatches.isEmpty()) {
                        android.util.Log.d("NativeSTT", "Promoting partial match to final result");
                        emitFinalResults(lastPartialMatches);
                        lastPartialMatches.clear();
                        if (continuous) {
                            scheduleRestart(expectedSessionId, 250);
                        } else {
                            stopRecognizerInternal(false);
                            emitStatus("stopped", null);
                        }
                        return;
                    }

                    if (continuous) {
                        scheduleRestart(expectedSessionId, 250);
                    } else {
                        stopRecognizerInternal(false);
                        emitStatus("stopped", "No speech detected");
                    }
                    return;
                }

                if (error == SpeechRecognizer.ERROR_NETWORK ||
                    error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ||
                    error == SpeechRecognizer.ERROR_SERVER ||
                    error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                    emitStatus("error", getErrorText(error));
                    if (continuous) {
                        scheduleRestart(expectedSessionId, 1200);
                    } else {
                        stopRecognizerInternal(true);
                    }
                    return;
                }

                stopRecognizerInternal(true);
                emitStatus("error", getErrorText(error));
            }

            @Override
            public void onResults(Bundle results) {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                isListening = false;
                android.util.Log.d("NativeSTT", "onResults");
                lastPartialMatches.clear();

                JSObject resultData = new JSObject();
                resultData.put("matches", toMatchesArray(results));
                resultData.put("isFinal", true);
                notifyListeners("finalResults", resultData);

                if (continuous) {
                    scheduleRestart(expectedSessionId, 250);
                } else {
                    stopRecognizerInternal(false);
                    emitStatus("stopped", null);
                }
            }

            @Override
            public void onPartialResults(Bundle results) {
                if (!isActiveSession(expectedSessionId)) {
                    return;
                }

                ArrayList<String> matches = results.getStringArrayList(
                    SpeechRecognizer.RESULTS_RECOGNITION
                );
                lastPartialMatches = matches != null ? new ArrayList<>(matches) : new ArrayList<>();
                android.util.Log.d(
                    "NativeSTT",
                    "onPartialResults: " + (matches != null ? matches.size() : 0) + " matches"
                );

                JSObject resultData = new JSObject();
                resultData.put("matches", toMatchesArray(results));
                resultData.put("isFinal", false);
                notifyListeners("partialResults", resultData);
            }

            @Override
            public void onEvent(int eventType, Bundle params) {}
        };
    }

    private void scheduleRestart(int expectedSessionId, long delayMs) {
        stopRecognizerInternal(false);
        mainHandler.postDelayed(() -> {
            if (!isActiveSession(expectedSessionId)) {
                return;
            }

            try {
                beginListeningCycle(expectedSessionId);
            } catch (Exception ex) {
                stopRecognizerInternal(false);
                emitStatus("error", "Failed to restart recognition");
                android.util.Log.e("NativeSTT", "Restart failed", ex);
            }
        }, delayMs);
    }

    private JSArray toMatchesArray(Bundle results) {
        ArrayList<String> matches = results.getStringArrayList(
            SpeechRecognizer.RESULTS_RECOGNITION
        );
        return toMatchesArray(matches);
    }

    private JSArray toMatchesArray(ArrayList<String> matches) {
        JSArray matchesArray = new JSArray();
        if (matches != null) {
            for (String match : matches) {
                matchesArray.put(match);
            }
        }
        return matchesArray;
    }

    private void emitFinalResults(ArrayList<String> matches) {
        JSObject resultData = new JSObject();
        resultData.put("matches", toMatchesArray(matches));
        resultData.put("isFinal", true);
        notifyListeners("finalResults", resultData);
    }

    private Intent buildIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, maxResults);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
            completeSilenceMillis
        );
        intent.putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
            possibleCompleteSilenceMillis
        );
        intent.putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS,
            minimumSpeechMillis
        );
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        return intent;
    }

    private void emitStatus(String status, String message) {
        JSObject data = new JSObject();
        data.put("status", status);
        if (message != null) {
            data.put("message", message);
        }
        notifyListeners("sttStatus", data);
    }

    private boolean isActiveSession(int expectedSessionId) {
        return !userStopped && expectedSessionId == sessionId;
    }

    private void stopRecognizerInternal(boolean notifyStopped) {
        isListening = false;

        if (recognizer != null) {
            try {
                recognizer.cancel();
            } catch (Exception ignored) {}

            try {
                recognizer.destroy();
            } catch (Exception ignored) {}

            recognizer = null;
        }

        if (notifyStopped) {
            emitStatus("stopped", null);
        }
    }

    private String normalizeLanguage(String requestedLanguage) {
        if (requestedLanguage == null || requestedLanguage.isEmpty()) {
            return "en-US";
        }

        if ("en-NZ".equalsIgnoreCase(requestedLanguage)) {
            return "en-US";
        }

        return requestedLanguage;
    }

    private void runOnMainThread(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
            return;
        }

        mainHandler.post(action);
    }

    private String getErrorText(int errorCode) {
        switch (errorCode) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "Audio recording error";
            case SpeechRecognizer.ERROR_CLIENT:
                return "Client side error";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Insufficient permissions";
            case SpeechRecognizer.ERROR_NETWORK:
                return "Network error";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Network timeout";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "No match found";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Recognition service busy";
            case SpeechRecognizer.ERROR_SERVER:
                return "Server error";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "No speech input";
            default:
                return "Unknown error: " + errorCode;
        }
    }

    @Override
    protected void handleOnDestroy() {
        runOnMainThread(() -> {
            userStopped = true;
            sessionId++;
            stopRecognizerInternal(false);
        });
        super.handleOnDestroy();
    }
}
