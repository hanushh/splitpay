package com.hanushh.paysplit.appfunctions.models

import androidx.appfunctions.AppFunctionSerializable

/** A single expense entry returned by getGroupExpenses. */
@AppFunctionSerializable
data class GroupExpenseItem(
    val expenseId: String,
    val description: String,
    val amountCents: Long,
    val currencyCode: String,
    val category: String,
    val paidByMemberId: String,
    val paidByName: String,
    val userShareCents: Long,
    val createdAt: String,
)

@AppFunctionSerializable
data class GroupExpensesResult(
    val groupId: String,
    val groupName: String,
    val expenses: List<GroupExpenseItem>,
    val totalAmountCents: Long,
)
