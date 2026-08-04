<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Dieser Fix ist nur für SQLite nötig (FK-Referenz nach Tabellen-Rename kaputt).
        // Auf PostgreSQL/MySQL ist der FK korrekt → Migration überspringen.
        if (DB::getDriverName() !== 'sqlite') {
            return;
        }

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

    public function down(): void {}
};
