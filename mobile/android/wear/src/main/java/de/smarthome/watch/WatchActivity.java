package de.smarthome.watch;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class WatchActivity extends Activity {
    private LinearLayout list;
    private JSONObject detail;
    private boolean versionChecked;
    private boolean updating;
    private boolean updateOffered;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final MessageClient.OnMessageReceivedListener messages = this::onMessage;
    private final BroadcastReceiver expectUpdates = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!updating) addUpdateButton();
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
        WatchApk.listen(this);
        applyMode(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyMode(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Wearable.getMessageClient(this).addListener(messages);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(expectUpdates, new IntentFilter("de.smarthome.WATCH_EXPECT"), Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(expectUpdates, new IntentFilter("de.smarthome.WATCH_EXPECT"));
        }
        if (updating) {
            showUpdating();
            return;
        }
        String mode = getIntent().getStringExtra("mode");
        if ("confirm".equals(mode) || "failed".equals(mode)) {
            applyMode(getIntent());
            getIntent().removeExtra("mode");
            return;
        }
        if (versionChecked) loadDevices();
        else refresh();
    }

    @Override
    protected void onPause() {
        Wearable.getMessageClient(this).removeListener(messages);
        try {
            unregisterReceiver(expectUpdates);
        } catch (Exception ignored) {
        }
        super.onPause();
    }

    private void onMessage(com.google.android.gms.wearable.MessageEvent event) {
        if ("/smarthome/hello".equals(event.getPath())) {
            String answer = new String(event.getData(), StandardCharsets.UTF_8);
            if ("ok".equals(answer)) {
                if (updating) return;
                versionChecked = true;
                loadDevices();
            } else if ("update".equals(answer)) {
                runOnUiThread(this::beginUpdate);
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

    private void loadDevices() {
        Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
            if (nodes.isEmpty()) {
                show("Handy nicht in der Nähe.");
                return;
            }
            Wearable.getMessageClient(this).sendMessage(nodes.get(0).getId(), "/smarthome/refresh", new byte[0]);
        });
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

    private void applyMode(Intent intent) {
        if (intent == null) return;
        String mode = intent.getStringExtra("mode");
        if ("updating".equals(mode)) beginUpdate();
        else if ("failed".equals(mode)) {
            updating = false;
            handler.removeCallbacksAndMessages(null);
            show("Update fehlgeschlagen.");
        } else if ("confirm".equals(mode)) {
            updating = false;
            handler.removeCallbacksAndMessages(null);
            show("Installation bestätigen.");
        }
    }

    private void beginUpdate() {
        updating = true;
        updateOffered = false;
        showUpdating();
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(() -> {
            if (!updating) return;
            updating = false;
            show("Update später.");
        }, 120000);
    }

    private void requestUpdate() {
        beginUpdate();
        send("pull", "");
    }

    private int expectedStored() {
        return getSharedPreferences("watch", MODE_PRIVATE).getInt("expected", 0);
    }

    private void addUpdateButton() {
        if (updateOffered || updating) return;
        int expected = expectedStored();
        if (expected <= 0 || installedVersion() >= expected) return;
        updateOffered = true;
        list.addView(pillButton("Aktualisieren", this::requestUpdate));
    }

    private void render(String json) {
        try {
            JSONObject payload = new JSONObject(json);
            if (payload.has("error")) {
                show(payload.getString("error"));
                return;
            }
            list.removeAllViews();
            updateOffered = false;
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
                else addUpdateButton();
                return;
            }
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                TextView row = label(item.optString("name", "Gerät") + "\n" + item.optString("label", ""), 14);
                row.setMinHeight(dp(52));
                pill(row, isActive(item.optString("status", "")));
                row.setPadding(dp(16), dp(8), dp(16), dp(8));
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
            addUpdateButton();
        } catch (Exception e) {
            show("Antwort unlesbar.");
        }
    }

    private void toggle(int id) {
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
        list.addView(pillButton("Zurück", () -> {
            detail = null;
            refresh();
        }));
        list.addView(label(detail.optString("name", "Gerät"), 16));
        list.addView(label(detail.optString("label", ""), 14));
        if ("thermostat".equals(screen)) {
            double setpoint = detail.optDouble("setpoint", 20);
            list.addView(label(String.format(java.util.Locale.US, "%.1f°C", setpoint), 22));
            list.addView(circle("−", () -> command(detail.optInt("id"), formatSetpoint(setpoint - 0.5))));
            list.addView(label("kälter", 12));
            list.addView(circle("+", () -> command(detail.optInt("id"), formatSetpoint(setpoint + 0.5))));
            list.addView(label("wärmer", 12));
            list.addView(pillButton("Heizung an", () -> command(detail.optInt("id"), "heat")));
            list.addView(pillButton("Heizung aus", () -> command(detail.optInt("id"), "off")));
        } else if ("dimmer".equals(screen)) {
            int level = detail.optInt("level", 50);
            list.addView(label(level + "%", 22));
            list.addView(circle("−", () -> command(detail.optInt("id"), String.valueOf(Math.max(0, level - 10)))));
            list.addView(label("dunkler", 12));
            list.addView(circle("+", () -> command(detail.optInt("id"), String.valueOf(Math.min(100, level + 10)))));
            list.addView(label("heller", 12));
        } else if ("cover".equals(screen)) {
            list.addView(pillButton("öffnen", () -> command(detail.optInt("id"), "open")));
            list.addView(pillButton("stoppen", () -> command(detail.optInt("id"), "stop")));
            list.addView(pillButton("schließen", () -> command(detail.optInt("id"), "close")));
        } else if ("fan".equals(screen)) {
            list.addView(pillButton("niedrig", () -> command(detail.optInt("id"), "low")));
            list.addView(pillButton("mittel", () -> command(detail.optInt("id"), "medium")));
            list.addView(pillButton("hoch", () -> command(detail.optInt("id"), "high")));
            list.addView(pillButton("aus", () -> command(detail.optInt("id"), "off")));
        } else if ("valve".equals(screen)) {
            list.addView(pillButton("öffnen", () -> command(detail.optInt("id"), "open")));
            list.addView(pillButton("schließen", () -> command(detail.optInt("id"), "close")));
        }
    }

    private String formatSetpoint(double value) {
        double clamped = Math.max(4, Math.min(35, value));
        return String.format(java.util.Locale.US, "%.1f", clamped);
    }

    private void command(int id, String status) {
        send("command", id + "\n" + status);
    }

    private boolean isActive(String status) {
        return "on".equals(status) || "heat".equals(status) || "auto".equals(status)
            || "open".equals(status) || "low".equals(status) || "medium".equals(status) || "high".equals(status);
    }

    private void pill(TextView view, boolean on) {
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(26));
        shape.setColor(Color.parseColor(on ? "#b45309" : "#3f3f46"));
        view.setBackground(shape);
    }

    private TextView circle(String text, Runnable action) {
        TextView view = label(text, 20);
        GradientDrawable shape = new GradientDrawable();
        shape.setShape(GradientDrawable.OVAL);
        shape.setColor(Color.parseColor("#3f3f46"));
        view.setBackground(shape);
        int size = dp(56);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        lp.topMargin = dp(8);
        view.setLayoutParams(lp);
        view.setGravity(Gravity.CENTER);
        view.setOnClickListener(v -> action.run());
        return view;
    }

    private TextView pillButton(String text, Runnable action) {
        TextView view = label(text, 15);
        view.setMinHeight(dp(48));
        pill(view, false);
        view.setPadding(dp(16), dp(8), dp(16), dp(8));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.topMargin = dp(8);
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

    private void showUpdating() {
        if (list == null) return;
        list.removeAllViews();
        updateOffered = false;
        ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleLarge);
        bar.setIndeterminate(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(48), dp(48));
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        lp.bottomMargin = dp(8);
        bar.setLayoutParams(lp);
        list.addView(bar);
        list.addView(label("Wird aktualisiert", 14));
    }

    private void show(String text) {
        list.removeAllViews();
        updateOffered = false;
        list.addView(label(text, 14));
        addUpdateButton();
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
