<?php

namespace App\Console\Commands;

use App\Models\Room;
use Illuminate\Console\Command;

class FixRoomIcons extends Command
{
    protected $signature   = 'rooms:fix-icons';
    protected $description = 'Ersetzt Lucide-Icon-Namen durch passende Emojis in der Rooms-Tabelle';

    // Lucide-Icon-Name → Emoji
    private const MAP = [
        'home'         => '🏠',
        'sofa'         => '🛋️',
        'bed'          => '🛏️',
        'utensils'     => '🍳',
        'bath'         => '🚿',
        'shower'       => '🚿',
        'lightbulb'    => '💡',
        'package'      => '📦',
        'tv'           => '📺',
        'car'          => '🚗',
        'tree'         => '🌳',
        'flower'       => '🌸',
        'office'       => '🏢',
        'briefcase'    => '💼',
        'dumbbell'     => '🏋️',
        'music'        => '🎵',
        'gamepad'      => '🎮',
        'book'         => '📚',
        'shirt'        => '👕',
        'baby'         => '👶',
    ];

    public function handle(): int
    {
        $rooms = Room::all();
        $fixed = 0;

        foreach ($rooms as $room) {
            $icon = $room->icon;

            // Schon ein Emoji (mehrbytiger UTF-8 Charakter) → überspringen
            if (mb_strlen($icon) >= 1 && mb_ord($icon) > 127) {
                continue;
            }

            $emoji = self::MAP[strtolower(trim($icon))] ?? '🏠';
            $room->update(['icon' => $emoji]);
            $this->line("  {$room->name}: '{$icon}' → '{$emoji}'");
            $fixed++;
        }

        $this->info("Fertig: {$fixed} von {$rooms->count()} Räume aktualisiert.");
        return Command::SUCCESS;
    }
}
