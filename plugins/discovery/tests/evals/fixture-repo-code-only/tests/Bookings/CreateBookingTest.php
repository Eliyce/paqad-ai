<?php

namespace Tests\Bookings;

use App\Bookings\Actions\CreateBooking;

class CreateBookingTest
{
    public const FIXTURE = 'invented-fixture';

    public function testCreatingABookingKeepsTheRoom(): bool
    {
        return (new CreateBooking())->createBookingForRoom(7, '2026-11-01')->roomId === 7;
    }
}
