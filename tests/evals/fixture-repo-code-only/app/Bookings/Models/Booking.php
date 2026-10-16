<?php

namespace App\Bookings\Models;

class Booking
{
    public const FIXTURE = 'invented-fixture';

    public int $roomId;
    public string $onDate;

    public function __construct(int $roomId, string $onDate)
    {
        $this->roomId = $roomId;
        $this->onDate = $onDate;
    }
}
