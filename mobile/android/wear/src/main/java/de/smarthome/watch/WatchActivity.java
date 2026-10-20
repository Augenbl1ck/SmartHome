package de.smarthome.watch;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.android.gms.wearable.ChannelClient;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class WatchActivity extends Activity {
    private LinearLayout list;
    private JSONObject detail;
    private final MessageClient.OnMessageReceivedListener messages = this::onMessage;
    private final ChannelClient.ChannelCallback channels = new ChannelClient.ChannelCallback() {
        @Override
        public void onChannelOpened(ChannelClient.Channel channel) {
            if (!"/smarthome/apk".equals(channel.getPath())) return;
            Wearable.getChannelClient(WatchActivity.this).getInputStream(channel).addOnSuccessListener(input ->
                new Thread(() -> saveAndInstall(input)).start()
            );
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        int inset = Math.round(getResources().getDisplayMetrics().widthPixels * 0.14f);
        list.setPadding(inset, inset, inset, inset);
        scroll.addView(list, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT,
            ScrollView.LayoutParams.WRAP_CONTENT
        ));
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Wearable.getMessageClient(this).addListener(messages);
        Wearable.getChannelClient(this).registerChannelCallback(channels);
        refresh();
    }

    @Override
    protected void onPause() {
        Wearable.getMessageClient(this).removeListener(messages);
        Wearable.getChannelClient(this).unregisterChannelCallback(channels);
        super.onPause();
    }

    private void onMessage(com.google.android.gms.wearable.MessageEvent event) {
        if ("/smarthome/hello".equals(event.getPath())) {
            String answer = new String(event.getData(), StandardCharsets.UTF_8);
            if ("ok".equals(answer)) {
                Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
                    if (!nodes.isEmpty()) {
                        Wearable.getMessageClient(this).sendMessage(nodes.get(0).getId(), "/smarthome/refresh", new byte[0]);
                    }
                });
            } else {
                runOnUiThread(() -> show("Aktualisieren…"));
            }
            return;
        }
        if (!"/smarthome/state".equals(event.getPath())) return;
        String json = new String(event.getData(), StandardCharsets.UTF_8);
        runOnUiThread(() -> render(json));
    }

    private void refresh() {
        show("Laden…");
        Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(this::askPhone).addOnFailureListener(e -> show("Handy nicht verbunden."));
    }

    private void askPhone(List<Node> nodes) {
        if (nodes.isEmpty()) {
            show("Handy nicht in der Nähe.");
            return;
        }
        Wearable.getMessageClient(this).sendMessage(
            nodes.get(0).getId(),
            "/smarthome/hello",
            String.valueOf(installedVersion()).getBytes(StandardCharsets.UTF_8)
        );
    }

    private void render(String json) {
        try {
            JSONObject payload = new JSONObject(json);
            if (payload.has("error")) {
                show(payload.getString("error"));
                return;
            }
            list.removeAllViews();
            String temp = payload.optString("temp", "");
            if (!temp.isEmpty()) {
                TextView head = label(temp, 22);
                list.addView(head);
            }
            JSONArray items = payload.optJSONArray("items");
            if (detail != null && items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.getJSONObject(i);
                    if (item.optInt("id") == detail.optInt("id")) detail = item;
                }
                renderDetail();
                return;
            }
            if (items == null || items.length() == 0) {
                if (temp.isEmpty()) show("Keine Geräte gewählt.");
                return;
            }
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                TextView row = label(item.optString("name", "Gerät") + "\n" + item.optString("label", item.optString("status", "")), 14);
                row.setMinHeight(dp(48));
                row.setBackgroundColor(Color.parseColor("#1c1917"));
                row.setPadding(dp(8), dp(6), dp(8), dp(6));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                );
                lp.topMargin = dp(6);
                row.setLayoutParams(lp);
                String screen = item.optString("screen", "switch");
                if ("info".equals(screen)) {
                    row.setOnClickListener(null);
                } else if ("switch".equals(screen)) {
                    int id = item.getInt("id");
                    row.setOnClickListener(v -> toggle(id));
                } else {
                    JSONObject chosen = item;
                    row.setOnClickListener(v -> {
                        detail = chosen;
                        renderDetail();
                    });
                }
                list.addView(row);
            }
        } catch (Exception e) {
            show("Antwort unlesbar.");
        }
    }

    private void toggle(int id) {
        show("Schalten…");
        send("toggle", String.valueOf(id));
    }

    private void send(String path, String body) {
        Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
            if (nodes.isEmpty()) {
                show("Handy nicht in der Nähe.");
                return;
            }
            Wearable.getMessageClient(this).sendMessage(
                nodes.get(0).getId(),
                "/smarthome/" + path,
                body.getBytes(StandardCharsets.UTF_8)
            );
        });
    }

    private void renderDetail() {
        if (detail == null) return;
        list.removeAllViews();
        String screen = detail.optString("screen", "");
        list.addView(button("Zurück", () -> {
            detail = null;
            refresh();
        }));
        list.addView(label(detail.optString("name", "Gerät"), 16));
        list.addView(label(detail.optString("label", ""), 14));
        if ("thermostat".equals(screen)) {
            double setpoint = detail.optDouble("setpoint", 20);
            list.addView(label(String.format(java.util.Locale.US, "%.1f°C", setpoint), 22));
            list.addView(button("−", () -> command(detail.optInt("id"), formatSetpoint(setpoint - 0.5))));
            list.addView(button("+", () -> command(detail.optInt("id"), formatSetpoint(setpoint + 0.5))));
            list.addView(button("Heizt", () -> command(detail.optInt("id"), "heat")));
            list.addView(button("Aus", () -> command(detail.optInt("id"), "off")));
        } else if ("dimmer".equals(screen)) {
            int level = detail.optInt("level", 50);
            list.addView(label(level + "%", 22));
            list.addView(button("−", () -> command(detail.optInt("id"), String.valueOf(Math.max(0, level - 10)))));
            list.addView(button("+", () -> command(detail.optInt("id"), String.valueOf(Math.min(100, level + 10)))));
        } else if ("cover".equals(screen)) {
            list.addView(button("Öffnen", () -> command(detail.optInt("id"), "open")));
            list.addView(button("Stopp", () -> command(detail.optInt("id"), "stop")));
            list.addView(button("Schließen", () -> command(detail.optInt("id"), "close")));
        }
    }

    private String formatSetpoint(double value) {
        double clamped = Math.max(4, Math.min(35, value));
        return String.format(java.util.Locale.US, "%.1f", clamped);
    }

    private void command(int id, String status) {
        show("Speichern…");
        send("command", id + "\n" + status);
    }

    private TextView button(String text, Runnable action) {
        TextView view = label(text, 16);
        view.setMinHeight(dp(48));
        view.setBackgroundColor(Color.parseColor("#1c1917"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.topMargin = dp(6);
        view.setLayoutParams(lp);
        view.setOnClickListener(v -> action.run());
        return view;
    }

    private int installedVersion() {
        try {
            return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
        } catch (Exception e) {
            return 0;
        }
    }

    private void saveAndInstall(InputStream input) {
        File file = new File(getCacheDir(), "smarthome-watch-update.apk");
        try (InputStream in = input; OutputStream out = new FileOutputStream(file)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        } catch (Exception e) {
            runOnUiThread(() -> show("Update fehlgeschlagen."));
            return;
        }
        runOnUiThread(() -> install(file));
    }

    private void install(File file) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + getPackageName())));
            return;
        }
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                try (OutputStream out = session.openWrite("base", 0, file.length()); InputStream in = new java.io.FileInputStream(file)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent callback = new Intent(this, WatchActivity.class);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent pending = PendingIntent.getActivity(this, sessionId, callback, flags);
                session.commit(pending.getIntentSender());
            }
            show("Installation bestätigen.");
        } catch (Exception e) {
            show("Update fehlgeschlagen.");
        }
    }

    private void show(String text) {
        list.removeAllViews();
        list.addView(label(text, 14));
    }

    private TextView label(String text, int sizeDp) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.WHITE);
        view.setTextSize(TypedValue.COMPLEX_UNIT_PX, dp(sizeDp));
        view.setGravity(Gravity.CENTER);
        view.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
