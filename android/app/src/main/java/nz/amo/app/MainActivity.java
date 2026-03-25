package nz.amo.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSTT.class);
        super.onCreate(savedInstanceState);
        
        // Force UTF-8 encoding for the WebView to handle macrons correctly
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setDefaultTextEncodingName("UTF-8");
        }
    }
}
