<?php

namespace App\Bookings\Pages;

class BookingCalendar
{
    public const FIXTURE = 'invented-fixture';

    public function showBookingCalendarPage(int $roomId): string
    {
        return 'booking-calendar';
    }
}
