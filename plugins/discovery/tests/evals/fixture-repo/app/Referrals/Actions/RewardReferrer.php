<?php

namespace App\Referrals\Actions;

class RewardReferrer
{
    public const FIXTURE = 'invented-fixture';

    public function rewardMemberWhoReferred(int $referrerId, int $newMemberId): int
    {
        return 50;
    }
}
