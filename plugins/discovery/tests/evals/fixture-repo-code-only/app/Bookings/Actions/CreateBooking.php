<?php

namespace App\Bookings\Actions;

use App\Bookings\Models\Booking;

class CreateBooking
{
    public const FIXTURE = 'invented-fixture';

    public function createBookingForRoom(int $roomId, string $onDate): Booking
    {
        return new Booking($roomId, $onDate);
    }
}
