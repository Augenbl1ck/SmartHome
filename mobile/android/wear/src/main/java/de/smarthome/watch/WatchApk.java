package de.smarthome.watch;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.google.android.gms.wearable.ChannelClient;
import com.google.android.gms.wearable.Wearable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

final class WatchApk {
    private static ChannelClient.ChannelCallback callback;
    private static volatile boolean installing;

    private WatchApk() {
    }

    static void listen(Context context) {
        if (callback != null) return;
        Context app = context.getApplicationContext();
        callback = new ChannelClient.ChannelCallback() {
            @Override
            public void onChannelOpened(ChannelClient.Channel channel) {
                if (!"/smarthome/apk".equals(channel.getPath()) || installing) return;
                installing = true;
                show(app, "updating");
                Wearable.getChannelClient(app).getInputStream(channel)
                    .addOnSuccessListener(input -> new Thread(() -> save(app, input)).start())
                    .addOnFailureListener(error -> {
                        installing = false;
                        show(app, "failed");
                    });
            }
        };
        Wearable.getChannelClient(app).registerChannelCallback(callback);
    }

    static void show(Context context, String mode) {
        Intent intent = new Intent(context, WatchActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("mode", mode);
        try {
            context.startActivity(intent);
        } catch (Exception ignored) {
        }
    }

    private static void save(Context context, InputStream input) {
        File file = new File(context.getCacheDir(), "smarthome-watch-update.apk");
        try (InputStream in = input; OutputStream out = new FileOutputStream(file)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        } catch (Exception e) {
            installing = false;
            show(context, "failed");
            return;
        }
        installing = false;
        if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + context.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(settings);
            return;
        }
        showInstall(context);
        if (!openInstaller(context)) commitSession(context, file);
    }

    static void showInstall(Context context) {
        Intent intent = new Intent("de.smarthome.WATCH_INSTALL_READY");
        intent.setPackage(context.getPackageName());
        context.sendBroadcast(intent);
        show(context, "install");
    }

    static boolean openInstaller(Context context) {
        File file = new File(context.getCacheDir(), "smarthome-watch-update.apk");
        if (!file.exists()) return false;
        try {
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, "application/vnd.android.package-archive");
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            context.startActivity(view);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static void commitSession(Context context, File file) {
        try {
            PackageInstaller installer = context.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                try (OutputStream out = session.openWrite("base", 0, file.length()); InputStream in = new java.io.FileInputStream(file)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent callbackIntent = new Intent(context, InstallResultReceiver.class);
                callbackIntent.setPackage(context.getPackageName());
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, callbackIntent, flags);
                session.commit(pending.getIntentSender());
            }
        } catch (Exception e) {
            show(context, "failed");
        }
    }
}
