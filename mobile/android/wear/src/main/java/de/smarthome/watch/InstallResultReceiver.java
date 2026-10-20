package de.smarthome.watch;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

public class InstallResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Integer.MIN_VALUE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = readConfirm(intent);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                    return;
                } catch (Exception ignored) {
                }
            }
        }
        if (status == PackageInstaller.STATUS_SUCCESS) return;
        WatchApk.showInstall(context);
    }

    private Intent readConfirm(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }
}
