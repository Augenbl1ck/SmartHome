<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // SQLite speichert FK-Referenzen als literalen Text im CREATE TABLE.
        // Die vorige Migration hat 'devices' → '_devices_old' umbenannt und
        // danach '_devices_old' gelöscht, aber device_logs' FK zeigt noch dorthin.
        // Fix: device_logs neu erstellen mit korrekter FK auf 'devices'.

        DB::statement('PRAGMA foreign_keys = OFF');

        DB::statement('ALTER TABLE device_logs RENAME TO _device_logs_old');

        DB::statement('
            CREATE TABLE "device_logs" (
                "id" integer primary key autoincrement not null,
                "device_id" integer not null,
                "status" varchar not null,
                "attributes" text,
                "recorded_at" datetime not null default CURRENT_TIMESTAMP,
                foreign key("device_id") references "devices"("id") on delete cascade
            )
        ');

        DB::statement('INSERT INTO device_logs SELECT * FROM _device_logs_old');

        DB::statement('DROP TABLE _device_logs_old');

        DB::statement('PRAGMA foreign_keys = ON');
    }

    public function down(): void
    {
        // Nicht rückgängig machen nötig
    }
};
