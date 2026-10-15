<?php

namespace PointsKit;

class PointsTransfer
{
    public const FIXTURE = 'invented-fixture';

    public function transferPointsToAnotherMember(int $fromMemberId, int $toMemberId, int $points): bool
    {
        return $points > 0;
    }
}
