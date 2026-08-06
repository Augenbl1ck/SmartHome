<?php

namespace Database\Seeders;

use App\Models\Automation;
use App\Models\Device;
use App\Models\Room;
use Illuminate\Database\Seeder;

class SmartHomeSeeder extends Seeder
{
    public function run(): void
    {
        $wohnzimmer = Room::create(['name' => 'Wohnzimmer', 'icon' => '🛋️']);
        $schlafzimmer = Room::create(['name' => 'Schlafzimmer', 'icon' => '🛏️']);
        $kueche = Room::create(['name' => 'Küche', 'icon' => '🍳']);

        Device::create([
            'name'       => 'Stehlampe',
            'type'       => 'plug',
            'room_id'    => $wohnzimmer->id,
            'mqtt_topic' => 'home/livingroom/lamp',
            'status'     => 'off',
        ]);

        Device::create([
            'name'       => 'Temperatursensor',
            'type'       => 'sensor_temperature',
            'room_id'    => $wohnzimmer->id,
            'mqtt_topic' => 'home/livingroom/temperature',
            'status'     => '21.5',
        ]);

        Device::create([
            'name'       => 'Bewegungsmelder',
            'type'       => 'sensor_motion',
            'room_id'    => $wohnzimmer->id,
            'mqtt_topic' => 'home/livingroom/motion',
            'status'     => 'false',
        ]);

        Device::create([
            'name'       => 'Deckenlampe',
            'type'       => 'light',
            'room_id'    => $schlafzimmer->id,
            'mqtt_topic' => 'home/bedroom/light',
            'status'     => 'off',
        ]);

        Device::create([
            'name'       => 'Temperatursensor',
            'type'       => 'sensor_temperature',
            'room_id'    => $schlafzimmer->id,
            'mqtt_topic' => 'home/bedroom/temperature',
            'status'     => '19.0',
        ]);

        Device::create([
            'name'       => 'Kaffeemaschine',
            'type'       => 'plug',
            'room_id'    => $kueche->id,
            'mqtt_topic' => 'home/kitchen/coffee',
            'status'     => 'off',
        ]);

        Automation::create([
            'name'    => 'Bewegung → Licht an',
            'trigger' => ['type' => 'mqtt', 'topic' => 'home/livingroom/motion', 'payload' => 'true'],
            'action'  => ['type' => 'mqtt', 'topic' => 'home/livingroom/lamp', 'payload' => 'on'],
            'enabled' => true,
        ]);

        Automation::create([
            'name'    => 'Temperatur > 28°C → Lüfter an',
            'trigger' => ['type' => 'threshold', 'topic' => 'home/livingroom/temperature', 'operator' => '>', 'value' => 28],
            'action'  => ['type' => 'mqtt', 'topic' => 'home/livingroom/fan', 'payload' => 'on'],
            'enabled' => false,
        ]);
    }
}
