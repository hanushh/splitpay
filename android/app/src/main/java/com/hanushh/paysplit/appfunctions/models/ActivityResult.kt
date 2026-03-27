package com.hanushh.paysplit.appfunctions.models

import androidx.appfunctions.AppFunctionSerializable

/** A single item in the user's activity feed. */
@AppFunctionSerializable
data class ActivityItem(
    val id: String,
    val type: String,          // "expense" | "settlement"
    val groupId: String,
    val groupName: String,
    val description: String,
    val amountCents: Long,
    val currencyCode: String,
    val createdAt: String,
)

@AppFunctionSerializable
data class ActivityFeedResult(
    val items: List<ActivityItem>,
)
