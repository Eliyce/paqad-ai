<?php

namespace App\Loyalty\Actions;

class EarnPoints
{
    public const FIXTURE = 'invented-fixture';

    public function earnPointsForOrder(int $memberId, int $orderTotal): int
    {
        return intdiv($orderTotal, 10);
    }
}
