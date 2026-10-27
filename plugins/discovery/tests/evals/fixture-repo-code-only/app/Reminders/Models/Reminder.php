<?php

namespace App\Reminders\Models;

class Reminder
{
    public const FIXTURE = 'invented-fixture';

    public int $bookingId;
    public string $state;

    public function __construct(int $bookingId, string $state)
    {
        $this->bookingId = $bookingId;
        $this->state = $state;
    }
}
