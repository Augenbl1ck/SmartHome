package de.smarthome.watch;

import android.content.Intent;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;
import java.nio.charset.StandardCharsets;

public class WatchWearService extends WearableListenerService {
    @Override
    public void onCreate() {
        super.onCreate();
        WatchApk.listen(this);
    }

    @Override
    public void onMessageReceived(MessageEvent event) {
        String path = event.getPath();
        if ("/smarthome/version-ask".equals(path)) {
            Wearable.getMessageClient(this).sendMessage(
                event.getSourceNodeId(),
                "/smarthome/version",
                String.valueOf(installed()).getBytes(StandardCharsets.UTF_8)
            );
            return;
        }
        if ("/smarthome/expect".equals(path)) {
            int value = 0;
            try {
                value = Integer.parseInt(new String(event.getData(), StandardCharsets.UTF_8).trim());
            } catch (NumberFormatException ignored) {
            }
            getSharedPreferences("watch", MODE_PRIVATE).edit().putInt("expected", value).apply();
            Intent intent = new Intent("de.smarthome.WATCH_EXPECT");
            intent.setPackage(getPackageName());
            sendBroadcast(intent);
            return;
        }
        if ("/smarthome/hello".equals(path)) {
            String body = new String(event.getData(), StandardCharsets.UTF_8);
            if ("update".equals(body)) WatchApk.show(this, "updating");
        }
    }

    private int installed() {
        try {
            return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
        } catch (Exception e) {
            return 0;
        }
    }
}
