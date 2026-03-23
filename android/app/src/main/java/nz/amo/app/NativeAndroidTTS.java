package nz.amo.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(name = "NativeAndroidTTS")
public class NativeAndroidTTS extends Plugin implements TextToSpeech.OnInitListener {
    private static final String TAG = "NativeAndroidTTS";
    
    private TextToSpeech tts;
    private boolean isInitialized = false;
    private int initSpeakerId = 0;
    private float initSpeed = 1.0f;
    private final HashMap<String, Integer> speakerIds = new HashMap<>();

    @Override
    public void load() {
        super.load();
        initializeTTS();
    }

    private void initializeTTS() {
        tts = new TextToSpeech(getContext(), this);
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            int result = tts.setLanguage(Locale.US);
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                isInitialized = false;
                return;
            }
            isInitialized = true;
            
            // Set male voice by default (lower pitch for masculine sound)
            tts.setPitch(0.85f);
            
            if (initSpeed != 1.0f) {
                setSpeechRate(initSpeed);
            }
        } else {
            isInitialized = false;
        }
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        initSpeakerId = call.getInt("speakerId", 0);
        initSpeed = call.getFloat("speed", 1.0f);

        JSObject result = new JSObject();
        result.put("available", isInitialized);
        
        Set<Voice> voices = tts.getVoices();
        if (voices != null) {
            StringBuilder voiceList = new StringBuilder();
            for (Voice v : voices) {
                if (voiceList.length() > 0) voiceList.append(",");
                voiceList.append(v.getName());
            }
            result.put("voices", voiceList.toString());
        }
        
        call.resolve(result);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (!isInitialized) {
            call.reject("TTS not initialized");
            return;
        }

        String text = call.getString("text", "");
        float speed = call.getFloat("speed", 1.0f);
        float pitch = call.getFloat("pitch", 1.0f);
        int speakerId = call.getInt("speakerId", initSpeakerId);

        if (text.isEmpty()) {
            call.reject("Missing text");
            return;
        }

        tts.setSpeechRate(speed);
        
        // Set pitch based on gender: lower for male (speakerId 5,6,9,10), higher for female (7,8)
        float adjustedPitch = pitch;
        if (speakerId == 5 || speakerId == 6 || speakerId == 9 || speakerId == 10) {
            // Male voices - lower pitch
            adjustedPitch = pitch * 0.85f;
        } else {
            // Female voices - normal/slightly higher
            adjustedPitch = pitch * 1.1f;
        }
        tts.setPitch(adjustedPitch);

        String utteranceId = UUID.randomUUID().toString();
        
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
            }

            @Override
            public void onDone(String utteranceId) {
                notifyListeners("tts-complete", new JSObject());
            }

            @Override
            public void onError(String utteranceId) {
                notifyListeners("tts-error", new JSObject().put("error", "TTS error"));
            }
        });

        int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        if (result == TextToSpeech.SUCCESS) {
            call.resolve();
        } else {
            call.reject("Failed to speak");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) {
            tts.stop();
        }
        call.resolve();
    }

    @PluginMethod
    public void getVoices(PluginCall call) {
        JSObject result = new JSObject();
        
        Set<Voice> voices = tts.getVoices();
        if (voices != null) {
            int index = 0;
            for (Voice v : voices) {
                if (v.getLocale().getLanguage().equals("en")) {
                    JSObject voice = new JSObject();
                    voice.put("name", v.getName());
                    voice.put("quality", v.getQuality());
                    voice.put("latency", v.getLatency());
                    voice.put("male", v.getFeatures().contains("gender:male"));
                    voice.put("female", v.getFeatures().contains("gender:female"));
                    result.put("voice_" + index, voice);
                    index++;
                }
            }
            result.put("count", index);
        }
        
        call.resolve(result);
    }

    private void setSpeechRate(float rate) {
        if (tts != null && isInitialized) {
            tts.setSpeechRate(rate);
        }
    }

    @Override
    protected void finalize() throws Throwable {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.finalize();
    }
}
