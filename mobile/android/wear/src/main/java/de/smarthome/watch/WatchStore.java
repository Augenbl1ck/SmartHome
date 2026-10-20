package de.smarthome.watch;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.android.gms.wearable.DataMap;

public final class WatchStore {
    private static final String PREF = "smarthome_watch";

    private WatchStore() {}

    public static void save(Context context, String home, String away, String devices) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit()
            .putString("home", home == null ? "" : home)
            .putString("away", away == null ? "" : away)
            .putString("devices", devices == null ? "" : devices)
            .apply();
    }

    public static void save(Context context, DataMap map) {
        save(context, map.getString("home", ""), map.getString("away", ""), map.getString("devices", ""));
    }

    public static String home(Context context) {
        return prefs(context).getString("home", "");
    }

    public static String away(Context context) {
        return prefs(context).getString("away", "");
    }

    public static String devices(Context context) {
        return prefs(context).getString("devices", "");
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }
}
