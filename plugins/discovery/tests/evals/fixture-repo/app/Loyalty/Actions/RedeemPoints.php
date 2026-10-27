<?php

namespace App\Loyalty\Actions;

class RedeemPoints
{
    public const FIXTURE = 'invented-fixture';

    public function redeemPointsAtCheckout(int $memberId, int $points): bool
    {
        return $points > 0;
    }
}
