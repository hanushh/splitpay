package com.hanushh.paysplit.appfunctions.models

import androidx.appfunctions.AppFunctionSerializable

/** Result returned after successfully creating or updating an expense. */
@AppFunctionSerializable
data class ExpenseResult(
    val expenseId: String,
    val groupId: String,
    val description: String,
    val amountCents: Long,
    val currencyCode: String,
    val category: String,
    val paidByMemberId: String,
    val splitCount: Int,
    val createdAt: String,
)
