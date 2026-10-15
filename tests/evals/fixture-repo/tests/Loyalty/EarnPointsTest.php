<?php

namespace Tests\Loyalty;

use App\Loyalty\Actions\EarnPoints;

class EarnPointsTest
{
    public const FIXTURE = 'invented-fixture';

    public function testEarningPointsAddsPointsToTheMember(): bool
    {
        return (new EarnPoints())->earnPointsForOrder(1, 100) > 0;
    }
}
