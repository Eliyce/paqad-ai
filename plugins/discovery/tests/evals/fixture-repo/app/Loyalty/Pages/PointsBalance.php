<?php

namespace App\Loyalty\Pages;

class PointsBalance
{
    public const FIXTURE = 'invented-fixture';

    public function showPointsBalancePage(int $memberId): string
    {
        return 'points-balance';
    }
}
