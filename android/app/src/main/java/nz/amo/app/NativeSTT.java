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
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
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

        String language = call.getString("language", "en-NZ");
        boolean continuous = call.getBoolean("continuous", false);
        boolean partialResults = call.getBoolean("partialResults", true);
        int maxResults = call.getInt("maxResults", 5);
        int completeSilenceMillis = call.getInt("completeSilenceMillis", 450);
        int possibleCompleteSilenceMillis = call.getInt("possibleCompleteSilenceMillis", 250);
        int minimumSpeechMillis = call.getInt("minimumSpeechMillis", 120);

        runOnMainThread(() -> {
            try {
                stopRecognizerInternal(false);

                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {}

                    @Override
                    public void onBeginningOfSpeech() {
                        JSObject data = new JSObject();
                        data.put("status", "listening");
                        notifyListeners("sttStatus", data);
                    }

                    @Override
                    public void onRmsChanged(float rmsdB) {}

                    @Override
                    public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {
                        // Wait for onResults/onError before tearing down the recognizer.
                    }

                    @Override
                    public void onError(int error) {
                        JSObject data = new JSObject();
                        data.put("status", "error");
                        data.put("message", getErrorText(error));
                        notifyListeners("sttStatus", data);

                        if (error == SpeechRecognizer.ERROR_NO_MATCH
                            || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            if (continuous && isListening) {
                                restartRecognizer(
                                    language,
                                    maxResults,
                                    partialResults,
                                    completeSilenceMillis,
                                    possibleCompleteSilenceMillis,
                                    minimumSpeechMillis
                                );
                            }
                        } else {
                            stopRecognizerInternal(true);
                        }
                    }

                    @Override
                    public void onResults(Bundle results) {
                        ArrayList<String> matches = results.getStringArrayList(
                            SpeechRecognizer.RESULTS_RECOGNITION
                        );
                        JSObject resultData = new JSObject();
                        JSArray matchesArray = new JSArray();
                        if (matches != null) {
                            for (String m : matches) {
                                matchesArray.put(m);
                            }
                        }
                        resultData.put("matches", matchesArray);
                        resultData.put("isFinal", true);
                        notifyListeners("finalResults", resultData);

                        if (continuous && isListening) {
                            restartRecognizer(
                                language,
                                maxResults,
                                partialResults,
                                completeSilenceMillis,
                                possibleCompleteSilenceMillis,
                                minimumSpeechMillis
                            );
                        } else {
                            stopRecognizerInternal(true);
                        }
                    }

                    @Override
                    public void onPartialResults(Bundle results) {
                        ArrayList<String> matches = results.getStringArrayList(
                            SpeechRecognizer.RESULTS_RECOGNITION
                        );
                        JSObject resultData = new JSObject();
                        JSArray matchesArray = new JSArray();
                        if (matches != null) {
                            for (String m : matches) {
                                matchesArray.put(m);
                            }
                        }
                        resultData.put("matches", matchesArray);
                        resultData.put("isFinal", false);
                        notifyListeners("partialResults", resultData);
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });

                recognizer.startListening(
                    buildIntent(
                        language,
                        maxResults,
                        partialResults,
                        completeSilenceMillis,
                        possibleCompleteSilenceMillis,
                        minimumSpeechMillis
                    )
                );
                isListening = true;
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
            stopRecognizerInternal(true);
            call.resolve();
        });
    }

    private void restartRecognizer(
        String language,
        int maxResults,
        boolean partialResults,
        int completeSilenceMillis,
        int possibleCompleteSilenceMillis,
        int minimumSpeechMillis
    ) {
        if (recognizer != null && isListening) {
            recognizer.startListening(
                buildIntent(
                    language,
                    maxResults,
                    partialResults,
                    completeSilenceMillis,
                    possibleCompleteSilenceMillis,
                    minimumSpeechMillis
                )
            );
        }
    }

    private Intent buildIntent(
        String language,
        int maxResults,
        boolean partialResults,
        int completeSilenceMillis,
        int possibleCompleteSilenceMillis,
        int minimumSpeechMillis
    ) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, maxResults);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
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
        return intent;
    }

    private void stopRecognizerInternal(boolean notifyStopped) {
        isListening = false;
        if (recognizer != null) {
            try {
                recognizer.stopListening();
            } catch (Exception ignored) {}
            try {
                recognizer.destroy();
            } catch (Exception ignored) {}
            recognizer = null;
        }

        if (notifyStopped) {
            JSObject data = new JSObject();
            data.put("status", "stopped");
            notifyListeners("sttStatus", data);
        }
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
            case SpeechRecognizer.ERROR_AUDIO: return "Audio recording error";
            case SpeechRecognizer.ERROR_CLIENT: return "Client side error";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Insufficient permissions";
            case SpeechRecognizer.ERROR_NETWORK: return "Network error";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Network timeout";
            case SpeechRecognizer.ERROR_NO_MATCH: return "No match found";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Recognition service busy";
            case SpeechRecognizer.ERROR_SERVER: return "Server error";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "No speech input";
            default: return "Unknown error: " + errorCode;
        }
    }

    @Override
    protected void handleOnDestroy() {
        runOnMainThread(() -> stopRecognizerInternal(false));
        super.handleOnDestroy();
    }
}
