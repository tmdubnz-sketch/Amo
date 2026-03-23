package nz.amo.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSTT.class);
        registerPlugin(NativeKokoro.class);
        registerPlugin(NativeAndroidTTS.class);
        super.onCreate(savedInstanceState);
    }
}
