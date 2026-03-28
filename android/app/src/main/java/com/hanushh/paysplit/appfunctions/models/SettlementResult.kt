package com.hanushh.paysplit.appfunctions.models

import androidx.appfunctions.AppFunctionSerializable

/** Result returned after recording a settlement payment. */
@AppFunctionSerializable
data class SettlementResult(
    val success: Boolean,
    val groupId: String,
    val payerMemberId: String,
    val payeeMemberId: String,
    val amountCents: Long,
    val currencyCode: String,
    val paymentMethod: String,
)
