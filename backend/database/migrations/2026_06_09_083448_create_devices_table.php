<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->enum('type', ['light', 'plug', 'sensor_temperature', 'sensor_humidity', 'sensor_motion', 'sensor_door', 'led', 'fan', 'other']);
            $table->foreignId('room_id')->constrained()->cascadeOnDelete();
            $table->string('mqtt_topic');
            $table->string('status')->default('unknown');
            $table->json('attributes')->nullable();
            $table->timestamp('last_seen')->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('devices');
    }
};
