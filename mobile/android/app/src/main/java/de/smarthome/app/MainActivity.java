package de.smarthome.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        WebView webView = getBridge().getWebView();
        String marker = "SmartHomeAndroid/" + installedVersion();
        String agent = webView.getSettings().getUserAgentString();
        if (!agent.contains("SmartHomeAndroid/")) {
            webView.getSettings().setUserAgentString(agent + " " + marker);
        }
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url != null && url.contains("smarthome.apk")) {
                installFrom(url);
            }
        });
        WatchBridge.setListener(new WatchBridge.Listener() {
            @Override
            public void onWatchVersion(String version) {
                emit("smarthome:watch-version", version);
            }

            @Override
            public void onWatchStatus(String status) {
                emit("smarthome:watch-update", status);
            }
        });
        webView.addJavascriptInterface(new AddressStore(this), "SmartHomeAddress");
        IntentFilter filter = new IntentFilter("de.smarthome.DEVICE_UPDATE");
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(deviceUpdates, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(deviceUpdates, filter);
        }
    }

    private final BroadcastReceiver deviceUpdates = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int id = intent.getIntExtra("id", 0);
            String status = intent.getStringExtra("status");
            if (id == 0 || status == null || getBridge() == null || getBridge().getWebView() == null) return;
            String js = "window.dispatchEvent(new CustomEvent('smarthome:device-update',{detail:{id:"
                + id + ",status:" + org.json.JSONObject.quote(status) + "}}))";
            getBridge().getWebView().evaluateJavascript(js, null);
        }
    };

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(deviceUpdates);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    public static final class AddressStore {
        private final Context context;

        AddressStore(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public String getHome() {
            return read("smarthome_home");
        }

        @JavascriptInterface
        public String getAway() {
            return read("smarthome_away");
        }

        @JavascriptInterface
        public void setHome(String value) {
            write("smarthome_home", value);
        }

        @JavascriptInterface
        public void setAway(String value) {
            write("smarthome_away", value);
        }

        @JavascriptInterface
        public String getWatchDevices() {
            return read("smarthome_watch_devices");
        }

        @JavascriptInterface
        public void setWatchDevices(String value) {
            write("smarthome_watch_devices", value);
        }

        @JavascriptInterface
        public String getWatchField() {
            return read("smarthome_watch_field");
        }

        @JavascriptInterface
        public void setWatchField(String value) {
            write("smarthome_watch_field", value);
        }

        @JavascriptInterface
        public String getPersonal() {
            return read("smarthome_personal");
        }

        @JavascriptInterface
        public void setPersonal(String value) {
            write("smarthome_personal", value);
        }

        @JavascriptInterface
        public String getPhoneVersion() {
            return WatchBridge.phoneVersion(context);
        }

        @JavascriptInterface
        public String getWatchExpected() {
            return String.valueOf(WatchBridge.expected(context));
        }

        @JavascriptInterface
        public String getWatchVersion() {
            return WatchBridge.lastVersion();
        }

        @JavascriptInterface
        public void askWatchVersion() {
            WatchBridge.ask(context);
        }

        @JavascriptInterface
        public void updateWatch() {
            WatchBridge.push(context);
        }

        private SharedPreferences prefs() {
            return context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        }

        private String read(String key) {
            String value = prefs().getString(key, "");
            return value == null ? "" : value;
        }

        private void write(String key, String value) {
            SharedPreferences.Editor editor = prefs().edit();
            if (value == null || value.trim().isEmpty()) {
                editor.remove(key);
            } else {
                editor.putString(key, value.trim());
            }
            editor.apply();
            WatchSync.push(context);
        }
    }

    private void emit(String name, String detail) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String js = "window.dispatchEvent(new CustomEvent(" + org.json.JSONObject.quote(name)
            + ",{detail:" + org.json.JSONObject.quote(detail == null ? "" : detail) + "}))";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    private long installedVersion() {
        try {
            android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return PackageInfoCompat.getLongVersionCode(info);
        } catch (Exception e) {
            return 0;
        }
    }

    private void installFrom(String url) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())
            );
            startActivity(settings);
            return;
        }
        new Thread(() -> {
            try {
                File file = new File(getCacheDir(), "smarthome-update.apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(120000);
                try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) >= 0) {
                        out.write(buf, 0, n);
                    }
                }
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                runOnUiThread(() -> startActivity(intent));
            } catch (Exception ignored) {
            }
        }).start();
    }
}
