<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automations', function (Blueprint $table) {
            $table->boolean('retry_if_blocked')->default(false)->after('enabled');
            $table->timestamp('blocked_retry_at')->nullable()->after('retry_if_blocked');
            $table->timestamp('blocked_retry_started_at')->nullable()->after('blocked_retry_at');
        });
    }

    public function down(): void
    {
        Schema::table('automations', function (Blueprint $table) {
            $table->dropColumn(['retry_if_blocked', 'blocked_retry_at', 'blocked_retry_started_at']);
        });
    }
};
