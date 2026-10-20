package de.smarthome.app;

import android.content.SharedPreferences;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

public class PhoneWearService extends WearableListenerService {
    @Override
    public void onMessageReceived(MessageEvent event) {
        String path = event.getPath();
        if ("/smarthome/hello".equals(path)) {
            int installed = 0;
            try {
                installed = Integer.parseInt(new String(event.getData(), StandardCharsets.UTF_8).trim());
            } catch (NumberFormatException ignored) {
            }
            int expected = expectedWatchVersion();
            if (installed != expected) {
                Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(), "/smarthome/hello", "update".getBytes(StandardCharsets.UTF_8));
                sendWatchApk(event.getSourceNodeId());
            } else {
                Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(), "/smarthome/hello", "ok".getBytes(StandardCharsets.UTF_8));
            }
            return;
        }
        String reply;
        if ("/smarthome/toggle".equals(path)) {
            String id = new String(event.getData(), StandardCharsets.UTF_8);
            reply = toggle(id);
        } else if ("/smarthome/refresh".equals(path)) {
            reply = list();
        } else {
            return;
        }
        Wearable.getMessageClient(this).sendMessage(
            event.getSourceNodeId(),
            "/smarthome/state",
            reply.getBytes(StandardCharsets.UTF_8)
        );
    }

    private int expectedWatchVersion() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open("watch-version.txt"), StandardCharsets.UTF_8))) {
            return Integer.parseInt(reader.readLine().trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private void sendWatchApk(String nodeId) {
        Wearable.getChannelClient(this).openChannel(nodeId, "/smarthome/apk").addOnSuccessListener(channel ->
            Wearable.getChannelClient(this).getOutputStream(channel).addOnSuccessListener(stream -> new Thread(() -> {
                try (InputStream in = getAssets().open("smarthome-watch.apk"); OutputStream out = stream) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
                } catch (Exception ignored) {
                }
            }).start())
        );
    }

    private String toggle(String rawId) {
        int id;
        try {
            id = Integer.parseInt(rawId.trim());
        } catch (NumberFormatException e) {
            return error("Gerät unbekannt.");
        }
        String base = reach();
        if (base.isEmpty()) return error("Pi nicht erreichbar.");
        try {
            JSONObject device = find(base, id);
            if (device == null) return error("Gerät nicht gefunden.");
            String status = device.optString("status", "");
            String type = device.optString("type", "");
            String next = "on".equals(status) || "heat".equals(status) || "open".equals(status) ? "off" : "on";
            if ("thermostat".equals(type) && "on".equals(next)) next = "heat";
            post(base + "/api/v1/devices/" + id + "/set-status", "{\"status\":\"" + next + "\"}");
        } catch (Exception e) {
            return error("Schalten fehlgeschlagen.");
        }
        return list();
    }

    private String list() {
        String ids = pref("smarthome_watch_devices");
        if (ids.isEmpty()) return error("Keine Geräte gewählt.");
        String base = reach();
        if (base.isEmpty()) return error("Pi nicht erreichbar.");
        try {
            JSONArray all = new JSONArray(get(base + "/api/v1/devices"));
            JSONArray items = new JSONArray();
            String temp = "";
            for (String raw : ids.split(",")) {
                int id;
                try {
                    id = Integer.parseInt(raw.trim());
                } catch (NumberFormatException e) {
                    continue;
                }
                JSONObject device = null;
                for (int i = 0; i < all.length(); i++) {
                    JSONObject candidate = all.getJSONObject(i);
                    if (candidate.optInt("id") == id) {
                        device = candidate;
                        break;
                    }
                }
                if (device == null) continue;
                String reading = temperature(device);
                if (temp.isEmpty() && !reading.isEmpty()) temp = reading;
                String type = device.optString("type", "");
                boolean toggle = !type.startsWith("sensor_") && !"button".equals(type) && !"energy_meter".equals(type);
                if (!toggle) continue;
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("name", device.optString("name", "Gerät"));
                item.put("status", device.optString("status", ""));
                item.put("type", type);
                items.put(item);
            }
            JSONObject out = new JSONObject();
            out.put("temp", temp);
            out.put("items", items);
            return out.toString();
        } catch (Exception e) {
            return error("Geräte nicht geladen.");
        }
    }

    private JSONObject find(String base, int id) throws Exception {
        JSONArray all = new JSONArray(get(base + "/api/v1/devices"));
        for (int i = 0; i < all.length(); i++) {
            JSONObject device = all.getJSONObject(i);
            if (device.optInt("id") == id) return device;
        }
        return null;
    }

    private String reach() {
        String home = pref("smarthome_home");
        String away = pref("smarthome_away");
        if (probe(home)) return trim(home);
        if (probe(away)) return trim(away);
        return "";
    }

    private String pref(String key) {
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
        String value = prefs.getString(key, "");
        return value == null ? "" : value;
    }

    private boolean probe(String base) {
        if (base == null || base.isEmpty()) return false;
        try {
            HttpURLConnection conn = open(trim(base) + "/api/v1/devices");
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            conn.disconnect();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        }
    }

    private String get(String url) throws Exception {
        HttpURLConnection conn = open(url);
        conn.setRequestMethod("GET");
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
            return body.toString();
        } finally {
            conn.disconnect();
        }
    }

    private void post(String url, String json) throws Exception {
        HttpURLConnection conn = open(url);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = conn.getOutputStream()) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        }
        int code = conn.getResponseCode();
        conn.disconnect();
        if (code >= 300) throw new IllegalStateException("Status " + code);
    }

    private HttpURLConnection open(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(4000);
        conn.setReadTimeout(8000);
        return conn;
    }

    private String trim(String url) {
        if (url == null) return "";
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    private String temperature(JSONObject device) {
        JSONObject attrs = device.optJSONObject("attributes");
        if (attrs != null) {
            String value = number(attrs, "temperature");
            if (value == null) value = number(attrs, "local_temperature");
            if (value != null) return value + "°C";
        }
        if ("sensor_temperature".equals(device.optString("type"))) {
            try {
                return String.format(java.util.Locale.US, "%.1f°C", Double.parseDouble(device.optString("status", "")));
            } catch (NumberFormatException ignored) {
                return "";
            }
        }
        return "";
    }

    private String number(JSONObject attrs, String key) {
        if (!attrs.has(key) || attrs.isNull(key)) return null;
        try {
            return String.format(java.util.Locale.US, "%.1f", attrs.getDouble(key));
        } catch (Exception e) {
            return null;
        }
    }

    private String error(String message) {
        return "{\"error\":\"" + message + "\"}";
    }
}
