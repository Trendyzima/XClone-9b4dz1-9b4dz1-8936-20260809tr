package site.testagram.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { TestagramApp(intent) }
    }
}

@Composable
private fun TestagramApp(initialIntent: Intent?) {
    var selected by remember { mutableIntStateOf(0) }
    var deepLink by remember { mutableStateOf(initialIntent?.data?.toString()) }

    MaterialTheme {
        Scaffold(
            bottomBar = {
                NavigationBar {
                    NavigationBarItem(selected == 0, { selected = 0 }, icon = { androidx.compose.material3.Icon(Icons.Default.Home, null) }, label = { Text("Home") })
                    NavigationBarItem(selected == 1, { selected = 1 }, icon = { androidx.compose.material3.Icon(Icons.Default.Groups, null) }, label = { Text("Communities") })
                }
            }
        ) { padding ->
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("Testagram", style = MaterialTheme.typography.headlineLarge)
                Text(
                    if (selected == 0) "Native Android client foundation" else "Communities",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 12.dp)
                )
                deepLink?.let {
                    Text("Deep link: $it", modifier = Modifier.padding(top = 16.dp))
                    TextButton(onClick = { deepLink = null }) { Text("Dismiss") }
                }
            }
        }
    }
}
