<?php

namespace App\Referrals\Actions;

class InviteFriend
{
    public const FIXTURE = 'invented-fixture';

    public function sendInviteToFriend(int $memberId, string $friendName): bool
    {
        return $friendName !== '';
    }
}
