package de.smarthome.watch;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

public final class WatchApi {
    private WatchApi() {}

    public static final class Item {
        public final int id;
        public final String name;
        public final String type;
        public final String status;
        public final String temperature;

        Item(int id, String name, String type, String status, String temperature) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.status = status;
            this.temperature = temperature;
        }

        public boolean toggleable() {
            return !type.startsWith("sensor_") && !"button".equals(type) && !"energy_meter".equals(type);
        }
    }

    public static String reach(String home, String away) {
        if (probe(home)) return trim(home);
        if (probe(away)) return trim(away);
        return "";
    }

    public static Item[] load(String base, String idList) throws Exception {
        String body = get(base + "/api/v1/devices");
        JSONArray all = new JSONArray(body);
        String[] wanted = idList == null || idList.isEmpty() ? new String[0] : idList.split(",");
        Item[] items = new Item[wanted.length];
        int n = 0;
        for (String raw : wanted) {
            int id;
            try {
                id = Integer.parseInt(raw.trim());
            } catch (NumberFormatException e) {
                continue;
            }
            for (int i = 0; i < all.length(); i++) {
                JSONObject device = all.getJSONObject(i);
                if (device.optInt("id") != id) continue;
                items[n++] = new Item(
                    id,
                    device.optString("name", "Gerät"),
                    device.optString("type", ""),
                    device.optString("status", ""),
                    temperature(device)
                );
                break;
            }
        }
        Item[] out = new Item[n];
        System.arraycopy(items, 0, out, 0, n);
        return out;
    }

    public static void setStatus(String base, int id, String status) throws Exception {
        byte[] payload = ("{\"status\":\"" + status + "\"}").getBytes(StandardCharsets.UTF_8);
        HttpURLConnection conn = open(base + "/api/v1/devices/" + id + "/set-status");
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = conn.getOutputStream()) {
            out.write(payload);
        }
        int code = conn.getResponseCode();
        conn.disconnect();
        if (code >= 300) throw new IllegalStateException("Status " + code);
    }

    private static String temperature(JSONObject device) {
        JSONObject attrs = device.optJSONObject("attributes");
        if (attrs != null) {
            String fromAttr = number(attrs, "temperature");
            if (fromAttr == null) fromAttr = number(attrs, "local_temperature");
            if (fromAttr != null) return fromAttr + "°C";
        }
        if ("sensor_temperature".equals(device.optString("type"))) {
            String status = device.optString("status", "");
            try {
                return String.format(java.util.Locale.US, "%.1f°C", Double.parseDouble(status));
            } catch (NumberFormatException ignored) {
                return "";
            }
        }
        return "";
    }

    private static String number(JSONObject attrs, String key) {
        if (!attrs.has(key) || attrs.isNull(key)) return null;
        try {
            return String.format(java.util.Locale.US, "%.1f", attrs.getDouble(key));
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean probe(String base) {
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

    private static String get(String url) throws Exception {
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

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(4000);
        conn.setReadTimeout(8000);
        return conn;
    }

    private static String trim(String url) {
        if (url == null) return "";
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
