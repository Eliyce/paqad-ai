<?php

namespace App\Bookings\Routes;

class BookingRoutes
{
    public const FIXTURE = 'invented-fixture';

    public function routes(): array
    {
        return [
            'GET /bookings/calendar' => 'BookingCalendar@showBookingCalendarPage',
            'POST /bookings' => 'CreateBooking@createBookingForRoom',
        ];
    }
}
