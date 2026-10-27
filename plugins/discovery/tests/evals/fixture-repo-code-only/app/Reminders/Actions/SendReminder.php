<?php

namespace App\Reminders\Actions;

use App\Reminders\Models\Reminder;

class SendReminder
{
    public const FIXTURE = 'invented-fixture';

    public function sendReminderForBooking(int $bookingId): Reminder
    {
        return new Reminder($bookingId, 'queued');
    }
}
