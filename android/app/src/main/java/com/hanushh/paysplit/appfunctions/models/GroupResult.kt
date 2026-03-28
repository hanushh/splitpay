package com.hanushh.paysplit.appfunctions.models

import androidx.appfunctions.AppFunctionSerializable

/**
 * Represents a single group returned by the listGroups App Function.
 * balanceCents > 0 means the user is owed money; < 0 means they owe money.
 */
@AppFunctionSerializable
data class GroupResult(
    val id: String,
    val name: String,
    val balanceCents: Long,
    val currencyCode: String,
    val memberCount: Int,
    val isArchived: Boolean,
)

@AppFunctionSerializable
data class GroupListResult(
    val groups: List<GroupResult>,
    val totalBalanceCents: Long,
)
