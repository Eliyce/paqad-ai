<?php

namespace Tests\Reminders;

use App\Reminders\Actions\SendReminder;

class SendReminderTest
{
    public const FIXTURE = 'invented-fixture';

    public function testSendingAReminderQueuesIt(): bool
    {
        return (new SendReminder())->sendReminderForBooking(7)->state === 'queued';
    }
}
