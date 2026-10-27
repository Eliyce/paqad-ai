<?php

namespace Tests\Referrals;

use App\Referrals\Actions\InviteFriend;

class InviteFriendTest
{
    public const FIXTURE = 'invented-fixture';

    public function testInvitingAFriendSendsAnInvite(): bool
    {
        return (new InviteFriend())->sendInviteToFriend(1, 'friend');
    }
}
