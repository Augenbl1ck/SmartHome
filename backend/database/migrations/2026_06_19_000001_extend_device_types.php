<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Erweitert den Device-Typ von ENUM auf STRING,
 * um alle Shelly-Gerätetypen unterstützen zu können.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            // SQLite unterstützt kein ALTER COLUMN → Tabelle neu erstellen
            DB::statement('PRAGMA foreign_keys = OFF');
            DB::statement('ALTER TABLE devices RENAME TO _devices_old');

            Schema::create('devices', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('type')->default('other');
                $table->foreignId('room_id')->constrained()->cascadeOnDelete();
                $table->string('mqtt_topic')->nullable();
                $table->string('status')->default('unknown');
                $table->json('attributes')->nullable();
                $table->timestamp('last_seen')->nullable();
                $table->boolean('active')->default(true);
                $table->timestamps();
            });

            DB::statement('INSERT INTO devices SELECT id, name, type, room_id, mqtt_topic, status, attributes, last_seen, active, created_at, updated_at FROM _devices_old');
            DB::statement('DROP TABLE _devices_old');
            DB::statement('PRAGMA foreign_keys = ON');
        } else {
            // PostgreSQL / MySQL: Spalte auf VARCHAR ändern
            Schema::table('devices', function (Blueprint $table) {
                $table->string('type')->default('other')->change();
            });
        }
    }

    public function down(): void
    {
        // Kein Rollback nötig – String ist flexibler als ENUM
    }
};
