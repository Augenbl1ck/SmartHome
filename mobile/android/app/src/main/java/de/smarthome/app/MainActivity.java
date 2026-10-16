package de.smarthome.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
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
    }

    private long installedVersion() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
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
