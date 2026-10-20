package de.smarthome.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import androidx.core.content.pm.PackageInfoCompat;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.ChannelClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class WatchBridge {
    public interface Listener {
        void onWatchVersion(String version);
        void onWatchStatus(String status);
    }

    private static volatile Listener listener;
    private static volatile String lastVersion = "";
    private static volatile CountDownLatch latch;
    private static volatile long lastPushAt;
    private static volatile int lastPushVersion;

    private WatchBridge() {
    }

    public static void setListener(Listener value) {
        listener = value;
    }

    public static String phoneVersion(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long code = PackageInfoCompat.getLongVersionCode(info);
            String name = info.versionName == null ? "" : info.versionName;
            return name + " (" + code + ")";
        } catch (Exception e) {
            return "";
        }
    }

    public static int expected(Context context) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(context.getAssets().open("watch-version.txt"), StandardCharsets.UTF_8))) {
            return Integer.parseInt(reader.readLine().trim());
        } catch (Exception e) {
            return 0;
        }
    }

    public static boolean hasApk(Context context) {
        try (InputStream in = context.getAssets().open("smarthome-watch.apk")) {
            return in.read() >= 0;
        } catch (Exception e) {
            return false;
        }
    }

    public static String lastVersion() {
        return lastVersion;
    }

    public static void noteHello(int installed) {
        publishVersion(String.valueOf(installed));
    }

    public static void onVersion(String value) {
        publishVersion(value == null ? "" : value.trim());
    }

    public static void ask(Context context) {
        new Thread(() -> {
            String known = lastVersion;
            try {
                List<Node> nodes = Tasks.await(Wearable.getNodeClient(context).getConnectedNodes(), 6, TimeUnit.SECONDS);
                if (nodes.isEmpty()) {
                    publishVersion(known);
                    return;
                }
                CountDownLatch wait = new CountDownLatch(1);
                latch = wait;
                Tasks.await(
                    Wearable.getMessageClient(context).sendMessage(nodes.get(0).getId(), "/smarthome/version-ask", new byte[0]),
                    6,
                    TimeUnit.SECONDS
                );
                if (!wait.await(6, TimeUnit.SECONDS)) publishVersion(lastVersion);
            } catch (Exception e) {
                publishVersion(known);
            }
        }).start();
    }

    public static boolean claimAuto(int version) {
        long now = System.currentTimeMillis();
        if (lastPushVersion == version && now - lastPushAt < 120_000) return false;
        lastPushAt = now;
        lastPushVersion = version;
        return true;
    }

    public static void push(Context context) {
        new Thread(() -> {
            status("Wird aktualisiert");
            String result = send(context);
            if ("ok".equals(result)) status("Auf der Uhr bestätigen. Die Uhr-App dabei offen lassen.");
            else if ("nicht verbunden".equals(result)) status("Uhr nicht verbunden.");
            else if ("keine Datei".equals(result)) status("Keine Uhr-Datei in der App.");
            else status("Update fehlgeschlagen.");
        }).start();
    }

    public static void sendApk(Context context, String nodeId) {
        try {
            ChannelClient channels = Wearable.getChannelClient(context);
            ChannelClient.Channel channel = Tasks.await(channels.openChannel(nodeId, "/smarthome/apk"), 20, TimeUnit.SECONDS);
            OutputStream stream = Tasks.await(channels.getOutputStream(channel), 20, TimeUnit.SECONDS);
            try (InputStream in = context.getAssets().open("smarthome-watch.apk"); OutputStream out = stream) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            }
        } catch (Exception ignored) {
        }
    }

    private static String send(Context context) {
        try {
            if (!hasApk(context)) return "keine Datei";
            List<Node> nodes = Tasks.await(Wearable.getNodeClient(context).getConnectedNodes(), 8, TimeUnit.SECONDS);
            if (nodes.isEmpty()) return "nicht verbunden";
            String id = nodes.get(0).getId();
            int version = expected(context);
            lastPushAt = System.currentTimeMillis();
            lastPushVersion = version;
            com.google.android.gms.wearable.MessageClient messages = Wearable.getMessageClient(context);
            Tasks.await(messages.sendMessage(id, "/smarthome/hello", "update".getBytes(StandardCharsets.UTF_8)), 8, TimeUnit.SECONDS);
            Tasks.await(messages.sendMessage(id, "/smarthome/expect", String.valueOf(version).getBytes(StandardCharsets.UTF_8)), 8, TimeUnit.SECONDS);
            Thread.sleep(400);
            sendApk(context, id);
            return "ok";
        } catch (Exception e) {
            return "fehlgeschlagen";
        }
    }

    private static void publishVersion(String value) {
        lastVersion = value == null ? "" : value;
        CountDownLatch pending = latch;
        if (pending != null) pending.countDown();
        Listener current = listener;
        if (current != null) current.onWatchVersion(lastVersion);
    }

    private static void status(String text) {
        Listener current = listener;
        if (current != null) current.onWatchStatus(text);
    }
}
