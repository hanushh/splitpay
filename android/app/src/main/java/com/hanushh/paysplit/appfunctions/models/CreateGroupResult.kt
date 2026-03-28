package com.hanushh.paysplit.appfunctions.models

import androidx.appfunctions.AppFunctionSerializable

/** Result returned after successfully creating a new group. */
@AppFunctionSerializable
data class CreateGroupResult(
    val groupId: String,
    val name: String,
    val description: String,
    val createdAt: String,
)
