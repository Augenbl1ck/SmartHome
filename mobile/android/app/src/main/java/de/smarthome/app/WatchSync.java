package de.smarthome.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.Wearable;

public final class WatchSync {
    private WatchSync() {}

    public static void push(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        PutDataMapRequest request = PutDataMapRequest.create("/smarthome/config");
        request.getDataMap().putString("home", value(prefs, "smarthome_home"));
        request.getDataMap().putString("away", value(prefs, "smarthome_away"));
        request.getDataMap().putString("devices", value(prefs, "smarthome_watch_devices"));
        request.getDataMap().putLong("updated", System.currentTimeMillis());
        request.setUrgent();
        Wearable.getDataClient(context).putDataItem(request.asPutDataRequest());
    }

    private static String value(SharedPreferences prefs, String key) {
        String stored = prefs.getString(key, "");
        return stored == null ? "" : stored;
    }
}
