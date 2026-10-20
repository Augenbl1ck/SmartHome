package de.smarthome.watch;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataClient;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.Wearable;

public class WatchActivity extends Activity {
    private LinearLayout list;
    private String base = "";
    private final DataClient.OnDataChangedListener dataListener = this::onData;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(12);
        list.setPadding(pad, pad, pad, pad);
        scroll.addView(list);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Wearable.getDataClient(this).addListener(dataListener);
        refresh();
    }

    @Override
    protected void onPause() {
        Wearable.getDataClient(this).removeListener(dataListener);
        super.onPause();
    }

    private void onData(DataEventBuffer events) {
        for (DataEvent event : events) {
            if (event.getType() != DataEvent.TYPE_CHANGED) continue;
            String path = event.getDataItem().getUri().getPath();
            if (path != null && path.equals("/smarthome/config")) {
                WatchStore.save(this, DataMapItem.fromDataItem(event.getDataItem()).getDataMap());
            }
        }
        refresh();
    }

    private void refresh() {
        show("Verbinden…");
        new Thread(() -> {
            String home = WatchStore.home(this);
            String away = WatchStore.away(this);
            String ids = WatchStore.devices(this);
            if ((home == null || home.isEmpty()) && (away == null || away.isEmpty())) {
                runOnUiThread(() -> show("Adressen kommen von der Handy-App."));
                return;
            }
            if (ids == null || ids.isEmpty()) {
                runOnUiThread(() -> show("Wähle Geräte in der Handy-App."));
                return;
            }
            String found = WatchApi.reach(home, away);
            if (found.isEmpty()) {
                runOnUiThread(() -> show("Pi nicht erreichbar."));
                return;
            }
            base = found;
            try {
                WatchApi.Item[] items = WatchApi.load(found, ids);
                runOnUiThread(() -> render(items));
            } catch (Exception e) {
                runOnUiThread(() -> show("Geräte nicht geladen."));
            }
        }).start();
    }

    private void render(WatchApi.Item[] items) {
        list.removeAllViews();
        String temp = "";
        for (WatchApi.Item item : items) {
            if (!item.temperature.isEmpty()) {
                temp = item.temperature;
                break;
            }
        }
        if (!temp.isEmpty()) {
            TextView head = label(temp, 28);
            head.setGravity(Gravity.CENTER);
            list.addView(head);
        }
        boolean any = false;
        for (WatchApi.Item item : items) {
            if (!item.toggleable()) continue;
            any = true;
            TextView row = label(item.name + "\n" + item.status, 16);
            row.setMinHeight(dp(48));
            row.setBackgroundColor(Color.parseColor("#1c1917"));
            row.setPadding(dp(10), dp(8), dp(10), dp(8));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            lp.topMargin = dp(8);
            row.setLayoutParams(lp);
            row.setOnClickListener(v -> toggle(item));
            list.addView(row);
        }
        if (!any && temp.isEmpty()) show("Keine Geräte gewählt.");
    }

    private void toggle(WatchApi.Item item) {
        String next = "on".equals(item.status) || "heat".equals(item.status) || "open".equals(item.status) ? "off" : "on";
        if ("thermostat".equals(item.type) && "on".equals(next)) next = "heat";
        String status = next;
        new Thread(() -> {
            try {
                WatchApi.setStatus(base, item.id, status);
            } catch (Exception ignored) {
            }
            refresh();
        }).start();
    }

    private void show(String text) {
        list.removeAllViews();
        list.addView(label(text, 16));
    }

    private TextView label(String text, int sp) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.WHITE);
        view.setTextSize(sp);
        view.setGravity(Gravity.CENTER_VERTICAL);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
