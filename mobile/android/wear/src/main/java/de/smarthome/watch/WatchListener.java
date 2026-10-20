package de.smarthome.watch;

import android.content.Context;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.WearableListenerService;

public class WatchListener extends WearableListenerService {
    @Override
    public void onDataChanged(DataEventBuffer events) {
        for (DataEvent event : events) {
            if (event.getType() != DataEvent.TYPE_CHANGED) continue;
            String path = event.getDataItem().getUri().getPath();
            if (path == null || !path.equals("/smarthome/config")) continue;
            WatchStore.save(this, DataMapItem.fromDataItem(event.getDataItem()).getDataMap());
        }
    }
}
